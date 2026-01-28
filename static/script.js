// Constants
const SAMPLE_RATE_IN = 16000;
const SAMPLE_RATE_OUT = 24000;

// State
let status = 'DISCONNECTED';
let selectedVoice = 'Zephyr';
let ws = null;
let inputAudioContext = null;
let outputAudioContext = null;
let scriptProcessor = null;
let activeSources = new Set();
let nextStartTime = 0;
let isAiSpeaking = false;
let stream = null;
let currentInput = "";
let currentOutput = "";

// DOM Elements
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const visualizerCanvas = document.getElementById('visualizer');
const messagesContainer = document.getElementById('messages');
const emptyState = document.getElementById('empty-state');
const errorMessage = document.getElementById('error-message');
const voiceBtns = document.querySelectorAll('.voice-btn');
const clearBtn = document.getElementById('clear-btn');

// Visualizer Context
const canvasCtx = visualizerCanvas.getContext('2d');
let animationId = null;
let volumeHistory = new Array(20).fill(0); // For smooth visualization

// Utils
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

function base64ToArrayBuffer(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

// UI Updates
function setStatus(newStatus) {
    status = newStatus;
    statusText.innerText = status;

    // Reset classes
    statusDot.className = 'status-dot';
    statusDot.classList.add(status.toLowerCase());

    if (status === 'CONNECTED') {
        startBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
        errorMessage.classList.add('hidden');
    } else {
        startBtn.classList.remove('hidden');
        stopBtn.classList.add('hidden');
    }

    voiceBtns.forEach(btn => btn.disabled = (status !== 'DISCONNECTED'));
}

function addMessage(role, text) {
    console.log(`Adding message to UI: [${role}] ${text}`);
    if (!messagesContainer) {
        console.error("Messages container not found!");
        return;
    }
    emptyState.style.display = 'none';

    const div = document.createElement('div');
    div.className = `message ${role}`;
    div.dataset.role = role;

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    div.innerHTML = `
        <div class="bubble">${text}</div>
        <span class="meta">${role === 'user' ? 'You' : 'Echo'} • ${time}</span>
    `;

    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    console.log("Message appended to DOM");
}

// Audio Logic
async function startSession() {
    try {
        setStatus('CONNECTING');

        // WebSocket
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

        ws.onopen = async () => {
            console.log("WS Connected");
            setStatus('CONNECTED');

            // Send config
            ws.send(JSON.stringify({ voice: selectedVoice }));

            // Start Audio
            await startAudio();
        };

        ws.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            console.log("Received data:", data); // verbose

            if (data.audio) {
                playAudio(data.audio);
            }

            // Handle Transcription
            if (data.type === 'transcription') {
                console.log(`Transcription (${data.role}): ${data.text}`);
                if (data.role === 'user') {
                    currentInput += data.text;
                } else if (data.role === 'model') {
                    currentOutput += data.text;
                }
            } else if (data.text && !data.type) {
                console.log("Legacy Text:", data.text);
                if (data.role === 'model') currentOutput += data.text;
            }

            // Handle Turn Complete
            if (data.turnComplete) {
                console.log("Turn Complete");
                const userText = currentInput.trim();
                const modelText = currentOutput.trim();

                if (userText) {
                    addMessage('user', userText);
                    currentInput = "";
                }

                if (modelText) {
                    addMessage('model', modelText);
                    currentOutput = "";
                }
            }

            if (data.interrupted) {
                // Clear buffers and stop audio
                currentInput = "";
                currentOutput = "";
                activeSources.forEach(s => s.stop());
                activeSources.clear();
                isAiSpeaking = false;
            }
        };

        ws.onclose = () => {
            console.log("WS Closed");
            cleanup();
        };

        ws.onerror = (err) => {
            console.error("WS Error", err);
            errorMessage.innerText = "Connection Failed";
            errorMessage.classList.remove('hidden');
            cleanup();
        };

    } catch (e) {
        console.error(e);
        errorMessage.innerText = e.message;
        errorMessage.classList.remove('hidden');
        cleanup();
    }
}

async function startAudio() {
    inputAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE_IN });
    outputAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE_OUT });

    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        if (!inputAudioContext) return; // Cleanup happened during await

        const source = inputAudioContext.createMediaStreamSource(stream);
        scriptProcessor = inputAudioContext.createScriptProcessor(4096, 1, 1);

        scriptProcessor.onaudioprocess = (e) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                const inputData = e.inputBuffer.getChannelData(0);

                // Visualization Data
                let sum = 0;
                for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
                const rms = Math.sqrt(sum / inputData.length);
                updateVisualizer(rms, isAiSpeaking);

                // Conversion to Int16 for Gemini
                const int16 = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    let s = Math.max(-1, Math.min(1, inputData[i]));
                    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }

                const base64Data = arrayBufferToBase64(int16.buffer);
                ws.send(JSON.stringify({
                    realtime_input: {
                        media: { data: base64Data }
                    }
                }));
            }
        };

        source.connect(scriptProcessor);
        scriptProcessor.connect(inputAudioContext.destination);

    } catch (e) {
        console.error("Audio Start Error", e);
        throw e;
    }
}

async function playAudio(base64Data) {
    if (!outputAudioContext) return;

    isAiSpeaking = true;
    const arrayBuffer = base64ToArrayBuffer(base64Data);

    // Manually decoding PCM (Int16 24kHz) to Float32 AudioBuffer
    // Web Audio API decodeAudioData expects a full file (wav/mp3), not raw PCM usually, 
    // unless wrapped in WAV container. Simple RAW PCM decoding:

    // Note: The backend is sending raw PCM (from Gemini)
    // We can just construct the buffer
    const pcm16 = new Int16Array(arrayBuffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768.0;
    }

    const buffer = outputAudioContext.createBuffer(1, float32.length, SAMPLE_RATE_OUT);
    buffer.getChannelData(0).set(float32);

    const source = outputAudioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(outputAudioContext.destination);

    const currentTime = outputAudioContext.currentTime;
    if (nextStartTime < currentTime) nextStartTime = currentTime;

    source.start(nextStartTime);
    nextStartTime += buffer.duration;

    activeSources.add(source);

    source.onended = () => {
        activeSources.delete(source);
        if (activeSources.size === 0) {
            isAiSpeaking = false;
        }
    };
}

function cleanup() {
    setStatus('DISCONNECTED');
    isAiSpeaking = false;

    if (ws) {
        ws.close();
        ws = null;
    }

    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }

    if (scriptProcessor) {
        scriptProcessor.disconnect();
        scriptProcessor = null;
    }

    if (inputAudioContext) {
        inputAudioContext.close();
        inputAudioContext = null;
    }

    if (outputAudioContext) {
        outputAudioContext.close();
        outputAudioContext = null;
    }

    activeSources.forEach(s => s.stop());
    activeSources.clear();
    nextStartTime = 0;
}

// Visualization
function updateVisualizer(volume, aiActive) {
    // Simply updating global vars, loop handles drawing
    volumeHistory.push(volume);
    volumeHistory.shift();
}

function draw() {
    if (!visualizerCanvas) return;

    const width = visualizerCanvas.width = visualizerCanvas.offsetParent.offsetWidth;
    const height = visualizerCanvas.height = visualizerCanvas.offsetParent.offsetHeight;

    canvasCtx.clearRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;
    // Current Volume (smoothed)
    const currentVol = volumeHistory[volumeHistory.length - 1] || 0;

    // Draw central circles
    const maxRadius = Math.min(width, height) / 3;
    let radius = 40 + (currentVol * 100);
    if (radius > maxRadius) radius = maxRadius;

    // Pulse effect
    canvasCtx.beginPath();
    canvasCtx.arc(centerX, centerY, radius, 0, 2 * Math.PI);

    if (status === 'CONNECTED') {
        canvasCtx.fillStyle = isAiSpeaking ? '#10b981' : '#3b82f6'; // Emerald or Blue
    } else {
        canvasCtx.fillStyle = '#475569'; // Slate
    }
    canvasCtx.fill();

    // Ripples
    if (status === 'CONNECTED' && currentVol > 0.01) {
        canvasCtx.beginPath();
        canvasCtx.arc(centerX, centerY, radius * 1.5, 0, 2 * Math.PI);
        canvasCtx.strokeStyle = isAiSpeaking ? 'rgba(16, 185, 129, 0.3)' : 'rgba(59, 130, 246, 0.3)';
        canvasCtx.stroke();
    }

    requestAnimationFrame(draw);
}

// Initialization
startBtn.addEventListener('click', startSession);
stopBtn.addEventListener('click', cleanup);
clearBtn.addEventListener('click', () => { messagesContainer.innerHTML = ''; emptyState.style.display = 'flex'; });

voiceBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        voiceBtns.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        selectedVoice = e.target.dataset.voice;
    });
});

// Start loop
draw();
