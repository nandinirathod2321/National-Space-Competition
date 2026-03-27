let ws = null;
let reconnectInterval = 3000;

export const startTelemetryWS = (onMessage, onStatusChange, onSimulationMessage) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/telemetry`;

    const connect = () => {
        console.log(`📡 Connecting to Telemetry WebSocket: ${wsUrl}`);
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('✅ Telemetry Uplink Established');
            onStatusChange('connected');
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'TELEMETRY_UPDATE') {
                    onMessage(msg.data);
                } else if (msg.type === 'SIMULATION_UPDATE') {
                    onSimulationMessage(msg);
                } else if (msg.type === 'INIT_SNAPSHOT') {
                    Object.values(msg.data).forEach(onMessage);
                }
            } catch (err) {
                console.error('WS Data Parse Error:', err);
            }
        };

        ws.onclose = () => {
            console.warn('❌ Telemetry Uplink Lost. Reconnecting...');
            onStatusChange('disconnected');
            setTimeout(connect, reconnectInterval);
        };

        ws.onerror = (err) => {
            console.error('WS Exception:', err);
            ws.close();
        };
    };

    connect();
};

export const stopTelemetryWS = () => {
    if (ws) {
        ws.close();
        ws = null;
    }
};
