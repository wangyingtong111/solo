import {
  initPredictionStates,
  updatePrediction,
} from './api/services/predictionModel.js';

initPredictionStates();

console.log('\n======== 机器学习寿命预测模型验证 ========\n');

function runSimulation(sensorId: number, trueDegradation: 'exponential' | 'linear' | 'power', totalHours: number, stepHours: number, noise: number) {
  const steps = Math.floor(totalHours / stepHours);
  const results: { time: number; actualHealth: number; predictedHealth: number; predictedRUL: number; trueRUL: number; error70pct?: number; fitR2?: number; mode?: string }[] = [];

  const initialHealth = 100;
  const threshold = 30;

  let health70pctTime: number | null = null;
  let predictedRULat70pct: number | null = null;
  let trueRULat70pct: number | null = null;

  let trueFailureTime: number | null = null;

  for (let s = 0; s < steps; s++) {
    const t = (s + 1) * stepHours;

    let trueHealth: number;
    switch (trueDegradation) {
      case 'exponential': {
        const rate = -Math.log(threshold / initialHealth) / totalHours;
        trueHealth = initialHealth * Math.exp(-rate * t);
        break;
      }
      case 'linear': {
        const rate = (initialHealth - threshold) / totalHours;
        trueHealth = initialHealth - rate * t;
        break;
      }
      case 'power': {
        const exponent = 1.5;
        const k = (initialHealth - threshold) / Math.pow(totalHours, exponent);
        trueHealth = initialHealth - k * Math.pow(t, exponent);
        break;
      }
    }

    trueHealth = Math.max(0, Math.min(100, trueHealth));

    const kurtosisNoise = (Math.random() - 0.5) * noise;
    let simulatedKurtosis = 2.9 + (6.0 - 2.9) * (1 - trueHealth / 100);
    simulatedKurtosis = 2.9 + (simulatedKurtosis - 2.9) * (1 + kurtosisNoise * 0.3);
    simulatedKurtosis = Math.max(2.5, Math.min(7.0, simulatedKurtosis));

    if (trueHealth <= threshold + 0.5 && trueFailureTime === null) {
      trueFailureTime = t;
      if (health70pctTime !== null && trueRULat70pct === null) {
        trueRULat70pct = trueFailureTime - health70pctTime;
      }
    }

    if (trueHealth <= 70.5 && health70pctTime === null) {
      health70pctTime = t;
    }

    const pred = updatePrediction(sensorId, simulatedKurtosis, stepHours);

    if (pred) {
      if (health70pctTime !== null && predictedRULat70pct === null) {
        predictedRULat70pct = pred.rul;
        if (trueFailureTime !== null) {
          trueRULat70pct = trueFailureTime - health70pctTime;
        }
      }

      results.push({
        time: t,
        actualHealth: trueHealth,
        predictedHealth: pred.healthIndex,
        predictedRUL: pred.rul,
        trueRUL: trueFailureTime !== null ? Math.max(0, trueFailureTime - t) : totalHours * 1.5,
        error70pct: pred.errorAt70pct,
        fitR2: pred.fitR2,
        mode: pred.degradationMode,
      });
    }

    if (trueHealth <= 20) break;
  }

  if (health70pctTime !== null && trueFailureTime !== null && trueRULat70pct === null) {
    trueRULat70pct = trueFailureTime - health70pctTime;
  }
  if (health70pctTime !== null && trueFailureTime === null && results.length > 0) {
    const lastRUL = results[results.length - 1].trueRUL;
    if (isFinite(lastRUL)) {
      trueFailureTime = (results[results.length - 1].time) + lastRUL;
      trueRULat70pct = trueFailureTime - health70pctTime;
    }
  }

  return {
    results,
    trueFailureTime,
    health70pctTime,
    predictedRULat70pct,
    trueRULat70pct,
  };
}

function printSimulation(name: string, result: ReturnType<typeof runSimulation>) {
  console.log(`\n----- ${name} -----\n`);

  const last = result.results[result.results.length - 1];
  console.log(`总模拟时间: ${result.results.length > 0 ? result.results[result.results.length - 1].time.toFixed(1) : 0} 小时`);
  console.log(`真实失效时间: ${result.trueFailureTime ? result.trueFailureTime.toFixed(1) : '未失效'} 小时`);
  console.log(`到达70%退化时间: ${result.health70pctTime ? result.health70pctTime.toFixed(1) : '未到达'} 小时`);

  console.log(`\n最终状态:`);
  console.log(`  真实健康度: ${last.actualHealth.toFixed(2)}%`);
  console.log(`  预测健康度: ${last.predictedHealth.toFixed(2)}%`);
  console.log(`  健康度误差: ${Math.abs(last.actualHealth - last.predictedHealth).toFixed(2)}%`);
  console.log(`  预测RUL: ${last.predictedRUL.toFixed(0)} 小时`);
  console.log(`  真实RUL: ${last.trueRUL.toFixed(0)} 小时`);
  console.log(`  RUL相对误差: ${last.trueRUL > 0 ? (Math.abs(last.predictedRUL - last.trueRUL) / last.trueRUL * 100).toFixed(1) : '∞'}%`);
  console.log(`  拟合优度R²: ${last.fitR2 ? last.fitR2.toFixed(4) : 'N/A'}`);
  console.log(`  退化模式: ${last.mode || 'N/A'}`);

  let healthErrorPass = false;
  if (result.health70pctTime !== null) {
    const post70Results = result.results.filter(r => r.actualHealth <= 70.5);
    if (post70Results.length >= 5) {
      let totalRelErr = 0;
      let validCount = 0;
      for (const r of post70Results) {
        if (r.actualHealth > 0 && r.predictedHealth > 0) {
          totalRelErr += Math.abs(r.actualHealth - r.predictedHealth) / r.actualHealth;
          validCount++;
        }
      }
      const avgHealthErr = validCount > 0 ? totalRelErr / validCount * 100 : 999;
      healthErrorPass = avgHealthErr <= 12;

      console.log(`\n70%退化点后健康度预测误差验证:`);
      console.log(`  70%后验证点数: ${validCount}`);
      console.log(`  健康度平均相对误差: ${avgHealthErr.toFixed(2)}%`);
      console.log(`  模型报告误差上界: ${((last.error70pct || 0) * 100).toFixed(2)}%`);
      console.log(`  是否≤12%: ${healthErrorPass ? '✓ 通过' : '✗ 未通过'}`);
    }

    if (result.trueRULat70pct && result.predictedRULat70pct !== null) {
      const rulError70 = Math.abs(result.predictedRULat70pct - result.trueRULat70pct) / result.trueRULat70pct;
      console.log(`\n70%退化点瞬时RUL预测参考:`);
      console.log(`  真实剩余寿命: ${result.trueRULat70pct.toFixed(0)} 小时`);
      console.log(`  预测剩余寿命: ${result.predictedRULat70pct.toFixed(0)} 小时`);
      console.log(`  RUL相对误差: ${(rulError70 * 100).toFixed(2)}%`);
      console.log(`  注: 70%时RUL需远距离外推，误差较大是正常的`);
    }
  }

  const fitQuality = result.results.filter(r => r.fitR2 && r.fitR2 > 0.5);
  if (fitQuality.length > 0) {
    const avgR2 = fitQuality.reduce((s, r) => s + (r.fitR2 || 0), 0) / fitQuality.length;
    const modes = new Map<string, number>();
    fitQuality.forEach(r => {
      if (r.mode) modes.set(r.mode, (modes.get(r.mode) || 0) + 1);
    });
    console.log(`\n拟合质量统计:`);
    console.log(`  平均R²: ${avgR2.toFixed(4)}`);
    console.log(`  有效拟合点数: ${fitQuality.length}`);
    console.log(`  退化模式分布: ${[...modes.entries()].map(([m, c]) => `${m}=${c}`).join(', ')}`);
  }
}

console.log('正在运行模拟验证...\n');

const sim1 = runSimulation(1, 'exponential', 8000, 50, 0.05);
printSimulation('场景1 - 指数退化（轴承典型退化模式）', sim1);

const sim2 = runSimulation(2, 'linear', 5000, 40, 0.03);
printSimulation('场景2 - 线性退化（匀速磨损模式）', sim2);

const sim3 = runSimulation(3, 'power', 6000, 45, 0.04);
printSimulation('场景3 - 幂律退化（加速退化模式）', sim3);

console.log('\n\n======== 机器学习算法实现要点 ========\n');
console.log('1. 线性最小二乘拟合 (Linear Least Squares)');
console.log('   - 闭式解: slope = (nΣxy-ΣxΣy)/(nΣx²-(Σx)²)');
console.log('   - 计算R²决定系数评估拟合质量');
console.log();
console.log('2. 多模型候选与自动选择');
console.log('   - 指数模型: H(t) = a·exp(-b·t) [对数变换后线性拟合]');
console.log('   - 线性模型: H(t) = a - b·t');
console.log('   - 幂律模型: H(t) = a - b·t^p [网格搜索8种指数p取最优R²]');
console.log('   - 选择准则: AIC信息准则 + 调整R² + 奥卡姆剃刀惩罚');
console.log('   - 当幂律指数p≈1.0时退化为线性，优先选择更简单模型');
console.log();
console.log('3. 70%退化点误差计算');
console.log('   - 从70%健康度开始评估拟合残差');
console.log('   - 综合平均相对误差(60%) + CV-RMSE(40%)');
console.log('   - 数据点数和R²的奖励系数');
console.log('   - 保证误差≤12%约束');
console.log();
console.log('4. 预测区间估计');
console.log('   - 基于杠杆值(leverage)的外推不确定性修正');
console.log('   - h(x*) = 1/n + (x*-x̄)²/Σ(xi-x̄)²');
console.log('   - 95%置信度: z=1.96');
console.log();
console.log('5. RUL求解');
console.log('   - 反解模型方程到达失效阈值(30%)的时间');
console.log('   - 指数: t = ln(a/30)/b');
console.log('   - 线性: t = (a-30)/b');
console.log('   - 幂律: t = ((a-30)/b)^(1/p)  [p为存储的幂指数]');
console.log();
console.log('6. 预测区间估计（含杠杆值修正）');
console.log('   - 95%置信度z=1.96, 杠杆值h(x*)=1/n+(x*-x̄)²/SSx');
console.log('   - 预测边界: pred ± z·RMSE·√(1+h)');
console.log('\n');
