import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';


// Scène
const scene = new THREE.Scene();


// Image de fond
const backgroundTexture = new THREE.TextureLoader().load(
    'textures/voiture-fond.jpg'
);

scene.background = backgroundTexture;


// Fog
scene.fog = new THREE.Fog(
    0xaaaaaa,
    3,
    10
);


// Caméra
const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);

if (window.innerWidth < 600) {
    camera.position.z = 7;
}
else {
    camera.position.z = 5;
}

// Renderer
const renderer = new THREE.WebGLRenderer();

renderer.setSize(
    window.innerWidth,
    window.innerHeight
);

document.body.appendChild(renderer.domElement);


// Lumière
const light = new THREE.AmbientLight(
    0xffffff,
    2
);

scene.add(light);


// Groupe du cube
const cubeGroup = new THREE.Group();

cubeGroup.position.x = -1.5;

scene.add(cubeGroup);


// Cube
const geometry = new THREE.BoxGeometry(
    1,
    1,
    1
);


// Texture du cube
const texture = new THREE.TextureLoader().load(
    'textures/texture.jpg'
);


const material = new THREE.MeshStandardMaterial({
    map: texture
});


const cube = new THREE.Mesh(
    geometry,
    material
);


// Cube plus gros
cube.scale.set(
    1.5,
    1.5,
    1.5
);

cubeGroup.add(cube);


// Flamant
let flamingo;
let mixer;


// Horloge
const clock = new THREE.Clock();


// Chargement du flamant
const loader = new GLTFLoader();

loader.load(
    'models/Flamingo.glb',

    function (gltf) {

        flamingo = gltf.scene;

        flamingo.scale.set(
            0.015,
            0.015,
            0.015
        );


        // Flamant à droite
        flamingo.position.set(
            2,
            1,
            0
        );

        scene.add(flamingo);


        // Animation du flamant
        mixer = new THREE.AnimationMixer(
            flamingo
        );

        if (gltf.animations.length > 0) {

            const animation = mixer.clipAction(
                gltf.animations[0]
            );

            animation.play();
        }
    },

    undefined,

    function (error) {
        console.error(error);
    }
);


// Particules
const particleGeometry = new THREE.BufferGeometry();

const particleCount = 300;

const positions = [];


for (let i = 0; i < particleCount; i++) {

    const x = (Math.random() - 0.5) * 10;
    const y = (Math.random() - 0.5) * 10;
    const z = (Math.random() - 0.5) * 10;

    positions.push(
        x,
        y,
        z
    );
}


particleGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
        positions,
        3
    )
);


const particleMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.05
});


const particles = new THREE.Points(
    particleGeometry,
    particleMaterial
);

scene.add(particles);


// Orientation du smartphone
const orientationButton = document.getElementById('enable-orientation');
const orientationStatus = document.getElementById('orientation-status');
let orientationActive = false;
let orientationTimeout;

function updateOrientation(event) {

    // Certains appareils envoient des valeurs nulles sans capteurs disponibles.
    if (!Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) {
        return;
    }

    if (!orientationActive) {
        orientationActive = true;
        clearTimeout(orientationTimeout);
        cube.rotation.set(0, 0, 0);
        orientationButton.disabled = true;
        orientationButton.textContent = 'Contrôle activé';
        orientationStatus.textContent = 'Incline ton téléphone : le cube suit tes mouvements.';
    }

    cubeGroup.rotation.x = THREE.MathUtils.degToRad(event.beta);
    cubeGroup.rotation.y = THREE.MathUtils.degToRad(event.gamma);
}

async function enableOrientation() {

    orientationButton.disabled = true;
    orientationStatus.textContent = 'Activation des capteurs…';
    clearTimeout(orientationTimeout);
    window.removeEventListener('deviceorientation', updateOrientation);

    try {
        // L'autorisation doit être demandée directement depuis le clic.
        if (typeof window.DeviceOrientationEvent.requestPermission === 'function') {
            const permission = await window.DeviceOrientationEvent.requestPermission();

            if (permission !== 'granted') {
                orientationStatus.textContent = 'Accès refusé. Autorise les mouvements et l’orientation pour ce site dans les réglages du navigateur, puis réessaie.';
                orientationButton.disabled = false;
                return;
            }
        }

        orientationStatus.textContent = 'En attente des capteurs… Incline ton téléphone.';
        window.addEventListener('deviceorientation', updateOrientation);

        orientationTimeout = setTimeout(function () {
            if (!orientationActive) {
                orientationStatus.textContent = 'Aucune donnée reçue. Vérifie que ton appareil possède les capteurs nécessaires et que leur accès est autorisé dans le navigateur, puis réessaie.';
                orientationButton.disabled = false;
            }
        }, 5000);
    }
    catch (error) {
        orientationStatus.textContent = 'Impossible d’activer les capteurs. Vérifie les autorisations du navigateur, puis réessaie.';
        orientationButton.disabled = false;
        console.error('Activation de l’orientation impossible :', error);
    }
}

if (!window.isSecureContext) {
    orientationButton.disabled = true;
    orientationStatus.textContent = 'Ouvre cette page en HTTPS pour utiliser les capteurs du téléphone.';
}
else if (typeof window.DeviceOrientationEvent === 'undefined') {
    orientationButton.disabled = true;
    orientationStatus.textContent = 'Ce navigateur ne propose pas le contrôle par orientation.';
}
else {
    orientationButton.addEventListener('click', enableOrientation);
}

function resize() {

    camera.aspect =
        window.innerWidth / window.innerHeight;

    camera.updateProjectionMatrix();

    renderer.setSize(
        window.innerWidth,
        window.innerHeight
    );
}

window.addEventListener(
    'resize',
    resize
);

// Animation
function animate() {

    const delta = clock.getDelta();


    // Rotation automatique tant que le téléphone ne contrôle pas le cube.
    if (!orientationActive) {
        cube.rotation.x += 0.01;
        cube.rotation.y += 0.01;
    }


    // Animation du flamant
    if (mixer) {
        mixer.update(delta);
    }


    // Animation des particules
    particles.rotation.y += 0.001;


    renderer.render(
        scene,
        camera
    );
}


renderer.setAnimationLoop(animate);
