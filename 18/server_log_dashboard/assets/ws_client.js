/**
 * WebSocket Client for Server Log Dashboard
 *
 * Architecture:
 *   1. Socket.IO connects to backend, receives realtime_data / anomaly_alert / forecast_alert
 *   2. Data is stored in window.WSClient.lastData for clientside callback consumption
 *   3. Anomaly/forecast alerts show as toast popups
 *   4. Connection status updates the LIVE indicator in the header
 *   5. Auto-reconnect with exponential backoff
 */
(function() {
    'use strict';

    var RECONNECT_BASE = 2000;
    var RECONNECT_MAX  = 30000;
    var socket = null;
    var connected = false;
    var attempts = 0;
    var timer = null;

    var WS = {
        lastData: null,
        lastPushId: -1,
        anomalyQueue: [],
        forecastAlertQueue: [],
    };

    function url() {
        var p = location.protocol === 'https:' ? 'wss:' : 'ws:';
        return p + '//' + location.host;
    }

    function setStatus(ok, text) {
        connected = ok;
        var el = document.getElementById('ws-status-indicator');
        if (!el) return;
        if (ok) {
            el.textContent = '● LIVE';
            el.style.color = '#10B981';
            el.style.backgroundColor = 'rgba(16, 185, 129, 0.2)';
            el.title = 'WebSocket connected';
        } else {
            el.textContent = '● ' + (text || 'RECONNECTING');
            el.style.color = '#F59E0B';
            el.style.backgroundColor = 'rgba(245, 158, 11, 0.2)';
            el.title = text || 'WebSocket reconnecting...';
        }
    }

    function setLastUpdate(ts) {
        var el = document.getElementById('ws-last-update');
        if (el && ts) {
            try { el.textContent = '更新: ' + new Date(ts).toLocaleTimeString(); } catch(e) {}
        }
    }

    function toast(html, bg, duration) {
        var d = document.createElement('div');
        d.style.cssText = 'position:fixed;top:80px;right:20px;z-index:10000;'
            + 'background:' + bg + ';color:#fff;padding:12px 18px;border-radius:8px;'
            + 'box-shadow:0 4px 12px rgba(0,0,0,0.25);font:13px -apple-system,BlinkMacSystemFont,sans-serif;'
            + 'max-width:360px;cursor:pointer;animation:wsSlideIn .3s ease-out;'
            + 'border-left:4px solid rgba(255,255,255,0.5);';
        d.innerHTML = html;
        d.onclick = function() { fade(d); };
        document.body.appendChild(d);
        setTimeout(function() { if (document.body.contains(d)) fade(d); }, duration || 8000);
    }

    function fade(el) {
        el.style.animation = 'wsFade .3s ease-in';
        setTimeout(function() { if (document.body.contains(el)) el.remove(); }, 300);
    }

    function onAnomaly(a) {
        if (!a) return;
        WS.anomalyQueue.push(a);
        var colors = { critical: '#DC2626', high: '#EA580C', medium: '#D97706' };
        var bg = colors[a.severity] || '#D97706';
        var sev = (a.severity || 'medium').toUpperCase();
        toast(
            '<div style="font-weight:600;font-size:11px;opacity:.9">\u26a0\ufe0f \u5f02\u5e38\u544a\u8b66 \u00b7 ' + sev + '</div>'
            + '<div style="line-height:1.4">' + (a.description || '') + '</div>'
            + '<div style="font-size:10px;opacity:.7;margin-top:4px">' + (a.service || '') + (a.timestamp ? ' \u00b7 ' + a.timestamp.slice(-8) : '') + '</div>',
            bg, 8000
        );
    }

    function onForecastAlert(a) {
        if (!a) return;
        WS.forecastAlertQueue.push(a);
        var colors = { critical: '#7C3AED', high: '#6366F1', medium: '#8B5CF6' };
        var bg = colors[a.severity] || '#8B5CF6';
        var sev = (a.severity || 'medium').toUpperCase();
        toast(
            '<div style="font-weight:600;font-size:11px;opacity:.9">\ud83d\udd2e \u9884\u6d4b\u9884\u8b66 \u00b7 ' + sev + '</div>'
            + '<div style="line-height:1.4">' + (a.message || '') + '</div>',
            bg, 10000
        );
    }

    function onRealtimeData(data) {
        if (!data) return;
        WS.lastData = data;
        WS.lastPushId = data._push_id;
        setLastUpdate(data._timestamp);

        if (window.dash_clientside) {
            var store = document.getElementById('ws-data-store');
            if (store && store._dashprivate_storeSetProps) {
                try { store._dashprivate_storeSetProps(data.aggregation || {}); } catch(e) {}
            }
            var aStore = document.getElementById('ws-anomalies-store');
            if (aStore && aStore._dashprivate_storeSetProps) {
                try { aStore._dashprivate_storeSetProps(data.anomalies || []); } catch(e) {}
            }
        }
    }

    function connect() {
        if (socket && socket.connected) return;

        setStatus(false, 'CONNECTING');
        try {
            socket = io(url(), {
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionDelay: RECONNECT_BASE,
                reconnectionDelayMax: RECONNECT_MAX,
                timeout: 20000,
            });

            socket.on('connect', function() {
                attempts = 0;
                setStatus(true);
                socket.emit('subscribe', { channels: ['realtime', 'anomalies', 'forecast'] });
            });

            socket.on('connected', function(d) {
                console.log('[WS] server confirmed, clients:', d.client_count);
            });

            socket.on('realtime_data', onRealtimeData);

            socket.on('anomaly_alert', function(d) {
                if (d && d.anomaly) onAnomaly(d.anomaly);
            });

            socket.on('forecast_alert', function(d) {
                if (d && d.alert) onForecastAlert(d.alert);
            });

            socket.on('disconnect', function(reason) {
                setStatus(false, 'DISCONNECTED');
            });

            socket.on('connect_error', function(err) {
                attempts++;
                setStatus(false, 'RETRY #' + attempts);
            });

            socket.on('reconnect', function(n) {
                setStatus(true);
            });

        } catch (e) {
            scheduleReconnect();
        }
    }

    function scheduleReconnect() {
        if (timer) clearTimeout(timer);
        var d = Math.min(RECONNECT_BASE * Math.pow(2, attempts), RECONNECT_MAX);
        timer = setTimeout(function() { attempts++; connect(); }, d);
    }

    function injectStyles() {
        if (document.getElementById('ws-styles')) return;
        var s = document.createElement('style');
        s.id = 'ws-styles';
        s.textContent = '@keyframes wsSlideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}@keyframes wsFade{from{opacity:1}to{opacity:0}}';
        document.head.appendChild(s);
    }

    function init() {
        injectStyles();
        if (typeof io === 'undefined') {
            var sc = document.createElement('script');
            sc.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
            sc.onload = connect;
            sc.onerror = function() { setStatus(false, 'SOCKET.IO LOAD FAIL'); };
            document.head.appendChild(sc);
        } else {
            connect();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 150);
    }

    window.WSClient = {
        getLastData: function() { return WS.lastData; },
        getLastPushId: function() { return WS.lastPushId; },
        getAnomalyQueue: function() { return WS.anomalyQueue; },
        getForecastAlertQueue: function() { return WS.forecastAlertQueue; },
        isConnected: function() { return connected; },
        connect: connect,
        disconnect: function() { if (socket) socket.disconnect(); },
    };
})();
