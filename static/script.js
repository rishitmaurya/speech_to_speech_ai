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
let scene, camera, renderer, robot, mouth, eyes, eyesContainer;
const avatarContainer = document.getElementById('avatar-container');
let volumeHistory = new Array(20).fill(0); // For smooth visualization

// 3D Logic
function initAvatar() {
    console.log("Initializing Avatar...");
    if (typeof THREE === 'undefined') {
        console.error("Three.js is NOT loaded!");
        return;
    }
    if (!avatarContainer) {
        console.error("Avatar container NOT found!");
        return;
    }
    console.log(`Container dimensions: ${avatarContainer.offsetWidth}x${avatarContainer.offsetHeight}`);

    // Scene Setup
    scene = new THREE.Scene();
    scene.background = null;

    // Camera
    camera = new THREE.PerspectiveCamera(50, avatarContainer.offsetWidth / avatarContainer.offsetHeight, 0.1, 1000);
    camera.position.z = 5;
    camera.position.y = 0.5;

    // Renderer
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(avatarContainer.offsetWidth, avatarContainer.offsetHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    avatarContainer.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 7);
    scene.add(directionalLight);

    const blueLight = new THREE.PointLight(0x3b82f6, 0.8);
    blueLight.position.set(-5, 0, 5);
    scene.add(blueLight);

    // Robot Model (Procedural)
    robot = new THREE.Group();
    scene.add(robot);

    // Head
    const headGeo = new THREE.SphereGeometry(1.2, 32, 32);
    const headMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.2,
        metalness: 0.1,
        emissive: 0x111111
    });
    const head = new THREE.Mesh(headGeo, headMat);
    robot.add(head);

    // Face Container
    const faceGroup = new THREE.Group();
    faceGroup.position.z = 1.05; // Slightly in front of head center
    robot.add(faceGroup);

    // Eyes
    eyesContainer = new THREE.Group();
    faceGroup.add(eyesContainer);

    const eyeGeo = new THREE.CapsuleGeometry(0.12, 0.15, 4, 8);
    // Rotate to make pills horizontal? No, vertical pills looked cute.
    // Let's rely on standard Capsule orientation (Y axis).
    const eyeMat = new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: 0x10b981,
        emissiveIntensity: 2
    });

    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.4, 0.2, 0);
    leftEye.rotation.z = Math.PI / 2; // Horizontal eyes
    eyesContainer.add(leftEye);

    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.4, 0.2, 0);
    rightEye.rotation.z = Math.PI / 2;
    eyesContainer.add(rightEye);

    eyes = [leftEye, rightEye];

    // Mouth
    const mouthGeo = new THREE.CapsuleGeometry(0.08, 0.3, 4, 8);
    // mouthGeo.rotateZ(Math.PI / 2); // Horizontal mouth
    const mouthMat = new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: 0x10b981,
        emissiveIntensity: 1
    });
    mouth = new THREE.Mesh(mouthGeo, mouthMat);
    mouth.position.set(0, -0.3, 0);
    mouth.rotation.z = Math.PI / 2; // Horizontal
    faceGroup.add(mouth);

    // Antenna
    const antStemGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.5);
    const antStemMat = new THREE.MeshStandardMaterial({ color: 0x64748b });
    const antStem = new THREE.Mesh(antStemGeo, antStemMat);
    antStem.position.y = 1.45;
    robot.add(antStem);

    const antBulbGeo = new THREE.SphereGeometry(0.08);
    const antBulbMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, emissive: 0x3b82f6, emissiveIntensity: 2 });
    const antBulb = new THREE.Mesh(antBulbGeo, antBulbMat);
    antBulb.position.y = 0.25;
    antStem.add(antBulb);

    // Handle Resize
    window.addEventListener('resize', onWindowResize, false);
    console.log("Avatar Initialized Successfully");
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
    // const currentVol = volumeHistory[volumeHistory.length - 1] || 0;
    // Smooth volume
    const currentVol = volumeHistory.reduce((a, b) => a + b, 0) / volumeHistory.length;

    // Idle Animation (Bobbing)
    if (robot) {
        robot.position.y = Math.sin(time * 2) * 0.1;
        robot.rotation.y = Math.sin(time * 0.5) * 0.05;
    }

    // Reaction to volume
    if (mouth) {
        let intensity = Math.min(currentVol * 10, 1.5);
        if (isAiSpeaking && currentVol > 0.01) {
            // Open mouth
            mouth.scale.set(1 + intensity * 0.5, 1 + intensity * 2, 1);
        } else {
            // Idle
            mouth.scale.set(1, 1, 1);
        }
    }

    // Eye Color State
    if (eyes && eyes.length > 0) {
        const targetColor = (status === 'CONNECTED' && isAiSpeaking) ? 0x10b981 : // Speaking: Green
            (status === 'CONNECTED') ? 0x3b82f6 : // Listening: Blue
                0x64748b; // Disconnected: Grey

        eyes.forEach(eye => {
            eye.material.emissive.setHex(targetColor);

            // Blink
            if (Math.random() > 0.995) {
                eye.scale.y = 0.1;
                eye.scale.x = 0.1; // Squint
            } else {
                eye.scale.y = 1;
                eye.scale.x = 1;
            }
        });

        if (mouth) mouth.material.emissive.setHex(targetColor);
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
    console.log("DOM Loaded. Starting Avatar Init...");
    initAvatar();
    animate();
});
