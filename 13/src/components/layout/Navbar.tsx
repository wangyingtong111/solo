import { NavLink } from 'react-router-dom';
import { Activity, BarChart3, TrendingDown, Settings, Bell, Wifi, WifiOff } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';

export default function Navbar() {
  const { alerts, wsConnected } = useAppStore();
  const warningCount = alerts.filter(a => a.level === 'warning').length;
  const criticalCount = alerts.filter(a => a.level === 'critical').length;

  const navItems = [
    { path: '/', label: '实时监控', icon: Activity },
    { path: '/waterfall', label: '瀑布图', icon: BarChart3 },
    { path: '/prediction', label: '寿命预测', icon: TrendingDown },
    { path: '/settings', label: '系统设置', icon: Settings },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 h-14 bg-deep-space/95 backdrop-blur-md border-b border-panel-border">
      <div className="h-full px-6 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-tech-cyan to-blue-600 flex items-center justify-center shadow-glow-cyan">
              <Activity className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="tech-title text-lg leading-tight">VibePredict</h1>
              <p className="text-xs text-gray-400 font-mono">旋转机械振动预测系统</p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? 'bg-tech-cyan/15 text-tech-cyan shadow-glow-cyan'
                      : 'text-gray-400 hover:text-tech-cyan hover:bg-tech-cyan/5'
                  }`
                }
              >
                <item.icon className="w-4 h-4" />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-xs">
            {wsConnected ? (
              <>
                <Wifi className="w-4 h-4 text-status-green" />
                <span className="text-status-green">在线</span>
              </>
            ) : (
              <>
                <WifiOff className="w-4 h-4 text-warning-red animate-pulse" />
                <span className="text-warning-red">连接中断</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {criticalCount > 0 && (
              <span className="flex items-center gap-1 px-2 py-1 text-xs font-bold text-white bg-warning-red rounded-full animate-pulse shadow-glow-red">
                <Bell className="w-3 h-3" />
                {criticalCount}
              </span>
            )}
            {warningCount > 0 && criticalCount === 0 && (
              <span className="flex items-center gap-1 px-2 py-1 text-xs font-bold text-white bg-warning-orange rounded-full">
                <Bell className="w-3 h-3" />
                {warningCount}
              </span>
            )}
          </div>

          <div className="text-right">
            <div className="text-xs text-gray-400">{new Date().toLocaleDateString('zh-CN')}</div>
            <div className="text-sm font-mono text-tech-cyan" id="clock">
              {new Date().toLocaleTimeString('zh-CN')}
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
