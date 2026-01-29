console.log("Vidya Script Initializing...");

// Constants
const SAMPLE_RATE_IN = 16000;
const SAMPLE_RATE_OUT = 24000;

// State
let status = 'DISCONNECTED';
let selectedVoice = 'Zephyr';
let ws = null;
let inputAudioContext = null;
let outputAudioContext = null;
let outputAnalyser = null;
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
let smileyGroup, mouthIdle, mouthSpeaking, topLip, bottomLip, smileyEyes, capTassel;

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
    console.log(`Avatar Container Size: ${avatarContainer.offsetWidth}x${avatarContainer.offsetHeight}`);
    if (avatarContainer.offsetWidth === 0 || avatarContainer.offsetHeight === 0) {
        console.warn("Avatar Container has 0 size! Check CSS.");
    }
    renderer.setSize(avatarContainer.offsetWidth, avatarContainer.offsetHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    avatarContainer.appendChild(renderer.domElement);

    // Lighting
    // Lighting (Brighter Setup)
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2); // High ambient
    scene.add(ambientLight);

    const mainLight = new THREE.DirectionalLight(0xffffff, 1.5);
    mainLight.position.set(5, 10, 7);
    scene.add(mainLight);

    // Spotlight for "Glow" / Sheen
    const spotLight = new THREE.SpotLight(0xffffff, 1.2);
    spotLight.position.set(0, 5, 5);
    spotLight.angle = Math.PI / 6;
    spotLight.penumbra = 0.5; // Soft edge
    spotLight.target = smileyGroup; // Follow head
    scene.add(spotLight);

    // Soft Fill Light
    const fillLight = new THREE.PointLight(0xFFFFFF, 0.5);
    fillLight.position.set(-5, 0, 5);
    scene.add(fillLight);

    // Group
    smileyGroup = new THREE.Group();
    scene.add(smileyGroup);
    spotLight.target = smileyGroup; // Bind target

    // 1. Face (Bright Orange Sphere)
    const faceGeo = new THREE.SphereGeometry(1.6, 64, 64);
    const faceMat = new THREE.MeshStandardMaterial({
        color: 0xFF8C00, // Orange
        emissive: 0xaa4400, // Self-illuminated inner glow
        emissiveIntensity: 0.1, // Reduced glow
        roughness: 0.7, // Matte finish (no sharp reflection)
        metalness: 0.0  // Plastic/Skin look
    });
    const face = new THREE.Mesh(faceGeo, faceMat);
    smileyGroup.add(face);

    // 2. Eyes (Black Dots)
    const eyeGeo = new THREE.SphereGeometry(0.18, 32, 32);
    eyeGeo.scale(1.2, 1.2, 0.6); // Slightly oval vertically, flattened Z
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


    // 4. Mouth System (Idle vs Speaking)

    // A. Idle Smile (Torus section)
    // Radius 0.3, Tube 0.04, RadialSeg 8, TubSeg 32, Arc PI (semicircle)
    const smileGeo = new THREE.TorusGeometry(0.3, 0.04, 16, 32, Math.PI * 0.8);
    const mouthColor = new THREE.MeshStandardMaterial({ color: 0x221111 });
    mouthIdle = new THREE.Mesh(smileGeo, mouthColor);
    mouthIdle.position.set(0, -0.3, 1.52);
    mouthIdle.rotation.z = Math.PI + (Math.PI * 0.1); // Rotate to be a smile (u shape)
    smileyGroup.add(mouthIdle);

    // B. Speaking Mouth (Hollow Circle / ring)
    const mouthSpeakingGeo = new THREE.TorusGeometry(0.2, 0.04, 16, 32);
    const mouthMat = new THREE.MeshStandardMaterial({ color: 0x331111 });
    mouthSpeaking = new THREE.Mesh(mouthSpeakingGeo, mouthMat);
    mouthSpeaking.position.set(0, -0.4, 1.55);
    mouthSpeaking.visible = false;
    smileyGroup.add(mouthSpeaking);

    // 5. Scholar Cap (Mortarboard)
    const capGroup = new THREE.Group();
    // Position on top of head
    capGroup.position.y = 1.3;
    capGroup.rotation.x = -0.2; // Tilt back
    capGroup.rotation.z = 0.1; // Tilt side
    smileyGroup.add(capGroup);

    // Cap Base (Skull cap)
    const capBaseGeo = new THREE.CylinderGeometry(1.2, 1.2, 0.5, 32);
    const capMat = new THREE.MeshStandardMaterial({
        color: 0x222222, // Dark Grey/Black 
        roughness: 0.6
    });
    const capBase = new THREE.Mesh(capBaseGeo, capMat);
    capGroup.add(capBase);

    // Board (Flat top)
    const boardGeo = new THREE.BoxGeometry(2.4, 0.1, 2.4);
    const board = new THREE.Mesh(boardGeo, capMat);
    board.position.y = 0.25;
    capGroup.add(board);

    // Tassel Logic (Pivot from side)
    const tasselPivot = new THREE.Group();
    tasselPivot.position.set(1.1, 0.3, 0.8); // Side Front Edge
    capGroup.add(tasselPivot);
    capTassel = tasselPivot; // Save for animation

    const goldMat = new THREE.MeshStandardMaterial({ color: 0xFFD700, metalness: 0.3, roughness: 0.4 });
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1), goldMat);
    string.position.y = -0.5; // Hang down
    tasselPivot.add(string);

    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.12), goldMat);
    knot.position.y = -1;
    tasselPivot.add(knot);

    // Button on top
    const button = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.1), goldMat);
    button.position.y = 0.35;
    capGroup.add(button);

    // Handle Resize
    window.addEventListener('resize', onWindowResize, false);
    console.log("Avatar Initialization Complete. Scene Objects:", scene.children.length);
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

let firstFrame = true;
function animate() {
    requestAnimationFrame(animate);
    if (firstFrame) {
        console.log("Animation Loop Started");
        firstFrame = false;
    }

    if (!renderer || !scene || !camera) return;

    const time = Date.now() * 0.001;

    // 1. Update Physics / Idle Movement
    if (smileyGroup) {
        // Bounce / Float
        smileyGroup.position.y = Math.sin(time * 1.5) * 0.1;
        smileyGroup.rotation.y = Math.sin(time * 0.5) * 0.05;
        smileyGroup.rotation.z = Math.sin(time * 0.3) * 0.02;
    }

    // Tassel Animation (Physics-ish swing)
    if (capTassel) {
        // Swing opposite to head rotation + some gravity lag
        capTassel.rotation.z = (Math.sin(time * 3) * 0.2) + 0.2; // Swing
        capTassel.rotation.x = Math.cos(time * 2) * 0.1;
    }

    // 2. AI Output Volume Analysis (Updates volumeHistory)
    if (isAiSpeaking && outputAnalyser) {
        const dataArray = new Uint8Array(outputAnalyser.frequencyBinCount);
        outputAnalyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const avg = sum / dataArray.length;
        const normVol = avg / 255;
        updateVisualizer(normVol, true);
    }

    // 3. Calculate Current Volume (AFTER update)
    const currentVol = volumeHistory.reduce((a, b) => a + b, 0) / volumeHistory.length;

    // 4. Mouth Switching Logic
    // REFINED: Hollow Circle -> Line -> Hollow Circle Loop
    if (mouthIdle && mouthSpeaking) {
        if (isAiSpeaking) {
            mouthIdle.visible = false;
            mouthSpeaking.visible = true;

            // Loop Animation: Circle (1.0) -> Line (0.1) -> Circle (1.0)
            // Speed: 8 seems fast enough for speech
            const loopSpeed = 8;

            // scaleY goes from 0.1 to 1.0
            // Math.sin oscillates -1 to 1. 
            // We want positive 0.1 to 1.0 cycle. 
            // Math.abs(Math.sin) gives 0 to 1 bounces.

            const scaleY = 0.1 + 0.9 * Math.abs(Math.sin(time * loopSpeed));

            mouthSpeaking.scale.set(1, scaleY, 1);

        } else {
            mouthIdle.visible = true;
            mouthSpeaking.visible = false;
        }
    }

    // 5. Proper Blinking
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
        // console.warn("Messages container not found - Chat UI is disabled.");
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
        // Reduce buffer size to 1024 for ultra-low latency (~64ms)
        scriptProcessor = inputAudioContext.createScriptProcessor(1024, 1, 1);

        scriptProcessor.onaudioprocess = (e) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                const inputData = e.inputBuffer.getChannelData(0);

                // Visualization Data
                let sum = 0;
                for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
                const rms = Math.sqrt(sum / inputData.length);
                updateVisualizer(rms, isAiSpeaking);

                // Barge-In / Interruption Detection
                // Lower threshold to 0.08 to catch single words, relying on AEC to kill echo
                if (isAiSpeaking && rms > 0.08) { // Increased threshold to avoid false positives
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

    // Initialize Analyser if needed
    if (!outputAnalyser) {
        outputAnalyser = outputAudioContext.createAnalyser();
        outputAnalyser.fftSize = 256;
    }

    const source = outputAudioContext.createBufferSource();
    source.buffer = buffer;

    // Connect Chain: Source -> Analyser -> Destination
    source.connect(outputAnalyser);
    outputAnalyser.connect(outputAudioContext.destination);

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
if (startBtn) startBtn.addEventListener('click', startSession);
if (stopBtn) stopBtn.addEventListener('click', cleanup);
if (clearBtn) {
    clearBtn.addEventListener('click', () => {
        if (messagesContainer) {
            messagesContainer.innerHTML = '';
            if (emptyState) emptyState.style.display = 'flex';
        }
    });
}

if (voiceBtns && voiceBtns.length > 0) {
    voiceBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            console.log("Voice selected:", e.target.dataset.voice);
            voiceBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            selectedVoice = e.target.dataset.voice;
        });
    });
} else {
    console.warn("No voice buttons found!");
}

// Start loop
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Loaded, starting Avatar...");
    initAvatar();
    animate();
});
