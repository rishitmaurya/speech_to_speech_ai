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

// 3D Avatar Context
const avatarContainer = document.getElementById('avatar-container');
let volumeHistory = new Array(20).fill(0); // For smooth visualization

// 3D Logic (Blue Cute Avatar)
let smileyGroup, mouthIdle, mouthSpeaking, smileyEyes;

function initAvatar() {
    if (typeof THREE === 'undefined') {
        console.error("Three.js is NOT loaded!");
        return;
    }
    if (!avatarContainer) {
        console.error("Avatar container NOT found!");
        return;
    }

    // Scene Setup
    scene = new THREE.Scene();
    scene.background = null;

    // Camera
    camera = new THREE.PerspectiveCamera(50, avatarContainer.offsetWidth / avatarContainer.offsetHeight, 0.1, 1000);
    camera.position.z = 5;
    camera.position.y = 0;

    // Renderer
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(avatarContainer.offsetWidth, avatarContainer.offsetHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    avatarContainer.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const mainLight = new THREE.DirectionalLight(0xffffff, 0.5);
    mainLight.position.set(5, 5, 5);
    scene.add(mainLight);

    // Soft Fill Light
    const fillLight = new THREE.PointLight(0xFFFFFF, 0.3);
    fillLight.position.set(-5, 5, 5);
    scene.add(fillLight);

    // Group
    smileyGroup = new THREE.Group();
    scene.add(smileyGroup);

    // 1. Face (Blue Sphere)
    const faceGeo = new THREE.SphereGeometry(1.6, 64, 64);
    const faceMat = new THREE.MeshStandardMaterial({
        color: 0x4FB0FF, // Light Blue
        roughness: 0.3,
        metalness: 0.1
    });
    const face = new THREE.Mesh(faceGeo, faceMat);
    smileyGroup.add(face);

    // 2. Eyes (Black Dots)
    const eyeGeo = new THREE.SphereGeometry(0.18, 32, 32);
    eyeGeo.scale(1, 1.2, 0.6); // Slightly oval vertically, flattened Z
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111 });

    smileyEyes = [];

    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.6, 0.2, 1.45);
    leftEye.rotation.x = -0.1;
    smileyGroup.add(leftEye);
    smileyEyes.push(leftEye);

    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.6, 0.2, 1.45);
    rightEye.rotation.x = -0.1;
    smileyGroup.add(rightEye);
    smileyEyes.push(rightEye);

    // 3. Cheeks (Pink Blush)
    const cheekGeo = new THREE.SphereGeometry(0.25, 32, 32);
    cheekGeo.scale(1.2, 0.8, 0.2); // Oval, flat
    const cheekMat = new THREE.MeshStandardMaterial({
        color: 0xFF88AA, // Pink
        opacity: 0.6,
        transparent: true
    });

    const leftCheek = new THREE.Mesh(cheekGeo, cheekMat);
    leftCheek.position.set(-0.9, -0.1, 1.35);
    leftCheek.rotation.z = 0.2;
    smileyGroup.add(leftCheek);

    const rightCheek = new THREE.Mesh(cheekGeo, cheekMat);
    rightCheek.position.set(0.9, -0.1, 1.35);
    rightCheek.rotation.z = -0.2;
    smileyGroup.add(rightCheek);


    // 4. Mouth System (Idle vs Speaking)

    // A. Idle Smile (Torus section)
    // Radius 0.3, Tube 0.04, RadialSeg 8, TubSeg 32, Arc PI (semicircle)
    const smileGeo = new THREE.TorusGeometry(0.3, 0.04, 16, 32, Math.PI * 0.8);
    const mouthColor = new THREE.MeshStandardMaterial({ color: 0x221111 });
    mouthIdle = new THREE.Mesh(smileGeo, mouthColor);
    mouthIdle.position.set(0, -0.3, 1.52);
    mouthIdle.rotation.z = Math.PI + (Math.PI * 0.1); // Rotate to be a smile (u shape)
    smileyGroup.add(mouthIdle);

    // B. Speaking Mouth (Circle/Capsule)
    const speakGeo = new THREE.SphereGeometry(0.2, 32, 32);
    speakGeo.scale(1, 1, 0.5);
    mouthSpeaking = new THREE.Mesh(speakGeo, mouthColor);
    mouthSpeaking.position.set(0, -0.4, 1.55);
    mouthSpeaking.visible = false; // Hidden initially
    smileyGroup.add(mouthSpeaking);

    // Handle Resize
    window.addEventListener('resize', onWindowResize, false);
}

function onWindowResize() {
    if (!camera || !renderer || !avatarContainer) return;
    camera.aspect = avatarContainer.offsetWidth / avatarContainer.offsetHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(avatarContainer.offsetWidth, avatarContainer.offsetHeight);
}

// Visualization Loop
function updateVisualizer(volume, aiActive) {
    volumeHistory.push(volume);
    volumeHistory.shift();
}

function animate() {
    requestAnimationFrame(animate);

    if (!renderer || !scene || !camera) return;

    const time = Date.now() * 0.001;
    const currentVol = volumeHistory.reduce((a, b) => a + b, 0) / volumeHistory.length;

    if (smileyGroup) {
        // Bounce / Float
        smileyGroup.position.y = Math.sin(time * 1.5) * 0.1;
        smileyGroup.rotation.y = Math.sin(time * 0.5) * 0.05;
        smileyGroup.rotation.z = Math.sin(time * 0.3) * 0.02;
    }

    // Mouth Switching Logic
    let isSpeakingNow = isAiSpeaking && currentVol > 0.01;

    if (mouthIdle && mouthSpeaking) {
        if (isSpeakingNow) {
            mouthIdle.visible = false;
            mouthSpeaking.visible = true;
            // Animate Speaking Mouth
            let intensity = Math.min(currentVol * 8, 1.2);
            mouthSpeaking.scale.set(0.8 + intensity * 0.2, 0.8 + intensity * 0.8, 0.5);
        } else {
            mouthIdle.visible = true;
            mouthSpeaking.visible = false;
        }
    }

    // Proper Blinking
    // Blink every 3-5 seconds
    if (smileyEyes) {
        const blinkTime = time % 4; // 4 second cycle
        if (blinkTime > 3.85) { // Last 150ms = blink
            smileyEyes.forEach(e => e.scale.y = 0.1);
        } else {
            smileyEyes.forEach(e => e.scale.y = 1.2);
        }
    }

    renderer.render(scene, camera);
}

// DOM Elements
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const messagesContainer = document.getElementById('messages');
const emptyState = document.getElementById('empty-state');
const errorMessage = document.getElementById('error-message');
const voiceBtns = document.querySelectorAll('.voice-btn');
const clearBtn = document.getElementById('clear-btn');

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

}

// Audio Logic
async function startSession() {
    try {
        setStatus('CONNECTING');

        // WebSocket
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

        ws.onopen = async () => {

            setStatus('CONNECTED');

            // Send config
            ws.send(JSON.stringify({ voice: selectedVoice }));

            // Start Audio
            await startAudio();
        };

        ws.onmessage = async (event) => {
            const data = JSON.parse(event.data);

            if (data.audio) {
                playAudio(data.audio);
            }

            // Handle Transcription
            if (data.type === 'transcription') {

                if (data.role === 'user') {
                    currentInput += data.text;
                } else if (data.role === 'model') {
                    currentOutput += data.text;
                }
            } else if (data.text && !data.type) {

                if (data.role === 'model') currentOutput += data.text;
            }

            // Handle Turn Complete
            if (data.turnComplete) {

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

            cleanup();
        };

        ws.onerror = (err) => {

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
        stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                sampleRate: SAMPLE_RATE_IN,
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });

        if (!inputAudioContext) return; // Cleanup happened during await

        const source = inputAudioContext.createMediaStreamSource(stream);
        // Reduce buffer size to 2048 for lower latency (approx 128ms at 16kHz)
        scriptProcessor = inputAudioContext.createScriptProcessor(2048, 1, 1);

        scriptProcessor.onaudioprocess = (e) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                const inputData = e.inputBuffer.getChannelData(0);

                // Visualization Data
                let sum = 0;
                for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
                const rms = Math.sqrt(sum / inputData.length);
                updateVisualizer(rms, isAiSpeaking);

                // Barge-In / Interruption Detection
                // If AI is speaking and user input is loud enough, stop AI
                if (isAiSpeaking && rms > 0.1) { // Increased threshold to avoid false positives
                    // console.log("Interruption detected!");
                    activeSources.forEach(s => s.stop());
                    activeSources.clear();
                    isAiSpeaking = false;
                }

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

// Authorization
// ...

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
document.addEventListener('DOMContentLoaded', () => {

    initAvatar();
    animate();
});
