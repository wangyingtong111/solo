import React from 'react';
import { useAppStore } from '../store/useAppStore';
import { usePermissionStore } from '../store/usePermissionStore';

export const Toolbar: React.FC = () => {
  const { document, connectionStatus, presences, openVersionPanel, openPermissionPanel } =
    useAppStore();
  const { currentUser } = usePermissionStore();

  const onlineUsers = presences
    .filter((p) => p.online && p.user)
    .map((p) => p.user!)
    .filter((user, index, self) => self.findIndex((u) => u.id === user.id) === index);

  const statusText = {
    connected: '已连接',
    connecting: '连接中...',
    disconnected: '已断开',
  }[connectionStatus];

  const getInitial = (name: string): string => {
    return name.charAt(0).toUpperCase();
  };

  return (
    <div className="toolbar">
      <span className="toolbar-title">{document?.name ?? '未命名表格'}</span>
      <div className="toolbar-spacer" />
      <div className="connection-status">
        <span className={`status-dot ${connectionStatus}`} />
        <span>{statusText}</span>
      </div>
      <div className="online-users">
        {onlineUsers.slice(0, 5).map((user) => (
          <div
            key={user.id}
            className="user-avatar"
            style={{ backgroundColor: user.color }}
          >
            {getInitial(user.name)}
            <div className="user-avatar-tooltip">
              {user.name}
              {user.id === currentUser?.id ? ' (我)' : ''}
            </div>
          </div>
        ))}
        {onlineUsers.length > 5 && (
          <div className="user-avatar" style={{ backgroundColor: '#5f6368' }}>
            +{onlineUsers.length - 5}
          </div>
        )}
      </div>
      <button className="toolbar-button" onClick={openVersionPanel}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        版本历史
      </button>
      <button className="toolbar-button" onClick={openPermissionPanel}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        分享权限
      </button>
    </div>
  );
};
