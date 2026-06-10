## 1. 架构设计

```mermaid
graph TB
    subgraph "前端 (React + TypeScript)"
        A1["实时监控面板"]
        A2["三维瀑布图 (Three.js)"]
        A3["预警弹窗组件"]
        A4["寿命预测图表"]
        A5["Zustand 状态管理"]
        A6["WebSocket 客户端"]
    end

    subgraph "后端 (Express + Node.js)"
        B1["WebSocket 服务"]
        B2["传感器数据模拟器"]
        B3["信号处理引擎"]
        B4["特征提取模块 (FFT/峭度/包络)"]
        B5["寿命预测模型"]
        B6["预警服务"]
        B7["REST API 接口"]
    end

    subgraph "数据层"
        C1["内存数据缓存"]
        C2["历史数据存储"]
    end

    A6 -->|实时数据流| B1
    B1 --> B2
    B2 --> B3
    B3 --> B4
    B4 --> B5
    B4 --> B6
    B6 --> B1
    B5 --> C1
    B4 --> C1
    A1 --> A5
    A2 --> A5
    A3 --> A5
    A4 --> A5
    A6 --> A5
```

## 2. 技术描述

- **前端框架**: React@18 + TypeScript + Vite
- **样式方案**: TailwindCSS@3
- **状态管理**: Zustand
- **路由**: React Router DOM
- **三维可视化**: Three.js + @react-three/fiber + @react-three/drei
- **图表库**: recharts (二维图表)
- **实时通信**: WebSocket (ws 库)
- **图标**: lucide-react
- **后端**: Express@4 + TypeScript
- **信号处理**: 自研 FFT 算法 + 数字信号处理工具库
- **数据存储**: 内存缓存 + JSON 文件持久化

## 3. 路由定义

| 路由 | 用途 |
|------|------|
| / | 实时监控面板（首页） |
| /waterfall | 三维瀑布图 |
| /prediction | 寿命预测 |
| /settings | 系统设置 |
| /history | 历史数据 |

## 4. API 定义

### 4.1 WebSocket 消息协议

```typescript
// 客户端 -> 服务端
interface ClientMessage {
  type: 'subscribe' | 'unsubscribe' | 'config';
  sensorIds?: number[];
  sampleRate?: number;
}

// 服务端 -> 客户端: 实时波形数据
interface WaveformData {
  type: 'waveform';
  timestamp: number;
  sensorId: number;
  samples: number[];  // 5000点/秒，分帧发送
}

// 服务端 -> 客户端: 特征指标
interface FeatureData {
  type: 'features';
  timestamp: number;
  sensorId: number;
  kurtosis: number;     // 峭度
  peak: number;         // 峰值
  rms: number;          // 有效值
  crestFactor: number;  // 峰值因子
  spectrum: number[];   // 频谱包络
}

// 服务端 -> 客户端: 预警信息
interface AlertData {
  type: 'alert';
  id: string;
  timestamp: number;
  sensorId: number;
  level: 'warning' | 'critical';
  kurtosis: number;
  threshold: number;
  message: string;
}

// 服务端 -> 客户端: 寿命预测
interface PredictionData {
  type: 'prediction';
  sensorId: number;
  rul: number;           // 剩余寿命 (小时)
  healthIndex: number;   // 健康度 0-100
  confidence: number;    // 置信度
  trend: number[];       // 退化趋势
  errorAt70pct: number;  // 70%退化点误差
}
```

### 4.2 REST API 接口

```typescript
// GET /api/sensors - 获取传感器列表
interface SensorListResponse {
  sensors: Array<{
    id: number;
    name: string;
    location: string;
    status: 'normal' | 'warning' | 'critical';
    sampleRate: number;
  }>;
}

// GET /api/history?sensorId=1&start=xxx&end=xxx - 历史数据
interface HistoryResponse {
  data: Array<{
    timestamp: number;
    kurtosis: number;
    rms: number;
    spectrum: number[];
  }>;
}

// GET /api/alerts - 预警历史
interface AlertListResponse {
  alerts: AlertData[];
  total: number;
}

// POST /api/config - 更新配置
interface ConfigUpdateRequest {
  kurtosisThreshold?: number;
  sampleRate?: number;
  alertEnabled?: boolean;
}
```

## 5. 服务器架构图

```mermaid
graph LR
    A["WebSocket 接入层"] --> B["数据分发器"]
    B --> C["传感器模拟/采集模块"]
    B --> D["信号处理流水线"]
    D --> D1["预处理 (滤波/去噪)"]
    D1 --> D2["FFT 频谱分析"]
    D2 --> D3["包络提取"]
    D3 --> D4["峭度计算"]
    D4 --> E["特征缓存"]
    D4 --> F["预警判定器"]
    F --> G["预警队列"]
    G --> A
    E --> H["寿命预测模型"]
    H --> I["预测结果缓存"]
    I --> A
    E --> J["历史数据持久化"]
    I --> J
```

## 6. 数据模型

### 6.1 数据模型定义

```mermaid
erDiagram
    SENSOR ||--o{ WAVEFORM : generates
    SENSOR ||--o{ FEATURE : has
    SENSOR ||--o{ ALERT : triggers
    SENSOR ||--o{ PREDICTION : has

    SENSOR {
        int id PK
        string name
        string location
        float sample_rate
        string status
    }

    WAVEFORM {
        bigint id PK
        int sensor_id FK
        bigint timestamp
        json samples
    }

    FEATURE {
        bigint id PK
        int sensor_id FK
        bigint timestamp
        float kurtosis
        float peak
        float rms
        float crest_factor
        json spectrum
    }

    ALERT {
        string id PK
        int sensor_id FK
        bigint timestamp
        string level
        float kurtosis_value
        float threshold
        string message
        boolean acknowledged
    }

    PREDICTION {
        bigint id PK
        int sensor_id FK
        bigint timestamp
        float rul
        float health_index
        float confidence
        float error_at_70pct
        json trend_data
    }
```

### 6.2 核心算法说明

1. **FFT 频谱分析**: 使用快速傅里叶变换将时域信号转换为频域，采样率 5000Hz，FFT 点数 1024，频率分辨率 ~4.88Hz
2. **包络提取**: 希尔伯特变换获取解析信号，计算幅值包络，用于轴承故障特征提取
3. **峭度计算**: 四阶统计量，反映信号冲击特性，正常范围 2.8-3.2，超 3.5 触发预警
4. **寿命预测模型**: 基于退化趋势的指数模型，使用历史峭度数据拟合，70%退化点后误差 < 12%
5. **预警延迟优化**: WebSocket 推送 + 前端状态机，端到端延迟 ≤ 1 秒
