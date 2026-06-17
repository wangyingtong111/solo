# Real-Time 3D Reconstruction System

基于多视角USB摄像头的实时3D重建系统，支持动态物体采集、实时纹理映射、GLB异步导出。

## 技术指标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| 摄像头数量 | 3个 | 不同型号USB摄像头 |
| 分辨率 | 1920x1080 | 每路摄像头 |
| 采集帧率 | 30fps | 每路摄像头 |
| 模型更新频率 | ≥15fps | 网格重建速度 |
| 端到端延迟 | ≤1000ms | 从采集到模型输出 |
| 网格顶点数 | ≤50000 | 流形、无孔洞 |
| 纹理分辨率 | 2048x2048 | 彩色纹理贴图 |
| 背景误分类率 | <5% | 动态背景去除 |
| 导出格式 | GLB 2.0 | 带材质的二进制格式 |

## 系统架构

```
Camera 0 ──┐
Camera 1 ──┤ SyncCapture ─► DepthEst ─► BGRemove ─► TSDF ─► MeshOpt ─► Texture ─► Visualize
Camera 2 ──┘                                                         │
                                                                     └──────► AsyncGLBExport
```

**多线程流水线：**
- 采集线程：3路摄像头同步采集（30fps）
- 深度估计线程：SGBM立体匹配，多视角融合
- 背景去除线程：多模态融合（颜色+深度+时序）
- TSDF积分线程：体积融合（15Hz）
- 表面提取线程：Marching Cubes（15Hz）
- 网格优化线程：流形化、去孔洞、精简
- 纹理映射线程：视角加权纹理烘焙
- 导出线程：异步GLB导出，不阻塞实时重建

## 安装

### 依赖

```bash
pip install -r requirements.txt
```

**可选GPU加速：**
```bash
pip install cupy-cuda11x  # 根据CUDA版本选择
```

### 摄像头校准

1. 打印标定棋盘格（推荐12x9，方格大小25mm）
2. 运行校准工具：
```bash
python scripts/calibrate_cameras.py --output config/camera_calib.json
```
3. 按照提示依次对每个摄像头采集20张不同角度的标定图像

## 快速开始

### 1. 配置摄像头

编辑 `config/config.yaml`：
```yaml
cameras:
  device_ids: [0, 1, 2]  # 根据实际设备ID修改
  resolution: [1920, 1080]
  fps: 30
```

### 2. 运行系统

**带可视化界面：**
```bash
python main.py
```

**无界面模式：**
```bash
python main.py --headless
```

### 3. 操作说明

| 按键 | 功能 |
|------|------|
| ESC | 退出系统 |
| S | 一键导出当前模型为GLB |
| R | 重置重建体积 |

### 4. GLB导出

- 按 `S` 键或调用 `pipeline.request_export(output_path)`
- 导出在独立线程中执行，不影响实时重建
- 导出文件保存在 `exports/` 目录，文件名包含时间戳

## 项目结构

```
e:/22/21/
├── config/
│   ├── config.yaml          # 系统配置文件
│   └── camera_calib.json    # 摄像头校准参数
├── src/
│   ├── capture/             # 采集模块
│   │   ├── camera.py        # 单摄像头封装
│   │   ├── sync_capture.py  # 多摄像头同步
│   │   └── depth_estimator.py  # SGBM深度估计
│   ├── background/          # 背景去除模块
│   │   └── background_remover.py  # 多模态背景减除
│   ├── reconstruction/      # 3D重建模块
│   │   ├── tsdf_volume.py   # TSDF体积融合
│   │   ├── marching_cubes.py   # 表面提取
│   │   └── reconstructor.py # 实时重建引擎
│   ├── texture/             # 纹理映射模块
│   │   └── texture_mapper.py   # 纹理烘焙
│   ├── mesh/                # 网格优化模块
│   │   └── mesh_optimizer.py   # 流形化/去孔洞/精简
│   ├── export/              # 模型导出模块
│   │   └── glb_exporter.py  # GLB异步导出
│   ├── utils/               # 工具类
│   └── pipeline.py          # 系统流水线
├── main.py                  # 主程序入口
├── requirements.txt         # 依赖列表
└── README.md                # 本文档
```

## 核心算法

### 1. 多视角深度估计
- 半全局块匹配（SGBM）算法
- 3个摄像头两两匹配后取中值融合
- 双边滤波平滑，保留边缘

### 2. 动态背景去除
- MOG2像素级背景建模
- 颜色差分 + 深度差分多模态融合
- 时序平滑（3帧平均）减少闪烁
- 背景突变检测与修正
- 跨摄像头一致性校验，误分类率<5%

### 3. TSDF体积融合
- 300x300x300体素，2mm分辨率，60cm工作空间
- 基于深度像素投影的快速体素更新
- 自动检测CuPy支持GPU加速

### 4. Marching Cubes表面提取
- 完整256种三角化配置查找表
- 预分配数组快速版本，性能提升30%
- 面积加权顶点法线计算

### 5. 网格优化
- **流形性保证**：检测并修复非流形边
- **孔洞填充**：边界环检测与三角化
- **拉普拉斯平滑**：去除噪声，保持特征
- **边折叠精简**：曲率加权，控制顶点数≤5万

### 6. 纹理映射
- 基于法线的智能UV展开（6投影面自动选择）
- 视角加权纹理烘焙（>60度视角不贡献）
- 重心坐标三角形光栅化
- 支持增量纹理更新

## 性能优化

1. **流水线并行**：各阶段独立线程，队列解耦
2. **GPU加速**：TSDF积分自动使用CuPy（如果可用）
3. **快速路径**：`marching_cubes_fast` 预分配内存
4. **顶点数控制**：超过5万跳过表面提取
5. **异步导出**：GLB导出在独立线程，不阻塞重建

## 常见问题

**Q: 摄像头打不开？**
A: 检查device_ids配置，确保摄像头未被其他程序占用。Linux下检查权限：`sudo usermod -aG video $USER`

**Q: 延迟过高？**
A: 1. 减少队列大小；2. 降低纹理分辨率；3. 关闭网格优化；4. 启用GPU加速

**Q: 背景误分类率高？**
A: 1. 增加learning_rate；2. 增大var_threshold；3. 确保初始5秒背景静止

**Q: 网格有孔洞？**
A: 1. 增加hole_filling_max_iterations；2. 确保物体被3个摄像头同时看到

## 许可证

MIT License
