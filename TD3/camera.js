import * as THREE from 'three';

// Exercice 2 : vidéo réelle en fond et objets Three.js par-dessus.
const video = document.getElementById('video');
const startButton = document.getElementById('start');
const calibrateButton = document.getElementById('calibrate');
const cameraStatus = document.getElementById('camera-status');
const geoStatus = document.getElementById('geo-status');
const orientationStatus = document.getElementById('orientation-status');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('scene3d').appendChild(renderer.domElement);
scene.add(new THREE.AmbientLight(0xffffff, 2));

const map = L.map('map').setView([46, 2], 5);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

let origin;
let userMarker;
let watchId;
let stream;
let lastOrientation;
let northOffset = 0;
let calibrated = false;
let absoluteOrientation = false;
let orientationTimer;
const points = [];
const earthRadius = 6371000;

// Repère local en mètres, valable près du point de départ : X est, Y haut, -Z nord.
function latLonToLocal(latitude, longitude) {
    const lat = THREE.MathUtils.degToRad(latitude - origin.latitude);
    const lon = THREE.MathUtils.degToRad(longitude - origin.longitude);
    const originLat = THREE.MathUtils.degToRad(origin.latitude);
    return new THREE.Vector3(
        earthRadius * lon * Math.cos(originLat), 0, -earthRadius * lat
    );
}

function addPoint(name, latitude, longitude, color) {
    const cube = new THREE.Mesh(
        new THREE.BoxGeometry(4, 4, 4),
        new THREE.MeshStandardMaterial({ color: color })
    );
    cube.position.copy(latLonToLocal(latitude, longitude));
    scene.add(cube);
    points.push(cube);

    L.circleMarker([latitude, longitude], {
        radius: 6, color: color, fillOpacity: 1
    }).addTo(map).bindTooltip(name);
}

function updatePosition(position) {
    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;

    if (!origin) {
        origin = { latitude, longitude };
        const latStep = THREE.MathUtils.radToDeg(50 / earthRadius);
        const lonStep = latStep / Math.cos(THREE.MathUtils.degToRad(latitude));

        // Créés une seule fois : les repères restent fixes quand on se déplace.
        addPoint('Nord', latitude + latStep, longitude, '#ff3333');
        addPoint('Est', latitude, longitude + lonStep, '#00cc44');
        addPoint('Sud', latitude - latStep, longitude, '#3366ff');
        addPoint('Ouest', latitude, longitude - lonStep, '#ff8800');
        userMarker = L.marker([latitude, longitude]).addTo(map).bindPopup('Ma position');
        map.setView([latitude, longitude], 17);
    }

    camera.position.copy(latLonToLocal(latitude, longitude));
    userMarker.setLatLng([latitude, longitude]);
    geoStatus.textContent = 'Position : ' + latitude.toFixed(5) + ', ' + longitude.toFixed(5)
        + ' — précision : ' + Math.round(position.coords.accuracy) + ' m.';
}

// Amélioration : ajouter ses propres objets géolocalisés depuis Leaflet.
map.on('click', function (event) {
    if (!origin) {
        geoStatus.textContent = 'Attends la première position GPS avant d’ajouter un objet.';
        return;
    }
    if (event.latlng.distanceTo(userMarker.getLatLng()) > 1000) {
        geoStatus.textContent = 'Choisis un point à moins de 1 km de ta position.';
        return;
    }
    addPoint('Point ' + (points.length + 1), event.latlng.lat, event.latlng.lng, '#ffdd00');
});

// Passage des angles du téléphone à l’orientation de la caméra Three.js.
// Même changement de repère que DeviceOrientationControls (exemple AR.js du TD).
function updateOrientation(event) {
    if (!Number.isFinite(event.alpha) || !Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) {
        return;
    }
    // Préférer les événements donnant une orientation liée au nord.
    const hasCompass = Number.isFinite(event.webkitCompassHeading);
    const isAbsolute = event.absolute === true || hasCompass;
    if (absoluteOrientation && !isAbsolute) {
        return;
    }
    if (isAbsolute && !absoluteOrientation) {
        northOffset = 0;
        calibrated = false;
    }
    absoluteOrientation = isAbsolute;
    lastOrientation = event;
    clearTimeout(orientationTimer);
    calibrateButton.disabled = false;

    const alpha = THREE.MathUtils.degToRad(hasCompass ? 360 - event.webkitCompassHeading : event.alpha);
    const beta = THREE.MathUtils.degToRad(event.beta);
    const gamma = THREE.MathUtils.degToRad(event.gamma);
    const screenAngle = THREE.MathUtils.degToRad(screen.orientation?.angle || window.orientation || 0);

    camera.quaternion.setFromEuler(new THREE.Euler(beta, alpha, -gamma, 'YXZ'));
    // La caméra regarde à travers le dos du téléphone.
    camera.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0), -Math.PI / 2
    ));
    camera.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1), -screenAngle
    ));
    camera.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0), northOffset
    ));

    if (!isAbsolute && !calibrated) {
        orientationStatus.textContent = 'Vise le nord avec la caméra, puis appuie sur « calibrer ».';
    } else {
        const direction = camera.getWorldDirection(new THREE.Vector3());
        const heading = (THREE.MathUtils.radToDeg(Math.atan2(direction.x, -direction.z)) + 360) % 360;
        orientationStatus.textContent = 'Direction : ' + Math.round(heading) + '° (0° = nord, 90° = est).';
    }
}

calibrateButton.addEventListener('click', function () {
    const direction = camera.getWorldDirection(new THREE.Vector3());
    northOffset += Math.atan2(direction.x, -direction.z);
    calibrated = true;
    updateOrientation(lastOrientation);
});

function stopSensors() {
    if (stream) {
        stream.getTracks().forEach(function (track) { track.stop(); });
        stream = undefined;
        video.srcObject = null;
    }
    if (watchId !== undefined) {
        navigator.geolocation.clearWatch(watchId);
        watchId = undefined;
    }
    window.removeEventListener('deviceorientation', updateOrientation);
    window.removeEventListener('deviceorientationabsolute', updateOrientation);
    clearTimeout(orientationTimer);
    lastOrientation = undefined;
    absoluteOrientation = false;
    northOffset = 0;
    calibrated = false;
    calibrateButton.disabled = true;
    startButton.disabled = false;
}

async function start() {
    if (!window.isSecureContext) {
        cameraStatus.textContent = 'Ouvre cette page en HTTPS (ou sur localhost pour tester sur ordinateur).';
        return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !navigator.geolocation || !window.DeviceOrientationEvent) {
        cameraStatus.textContent = 'Ce navigateur ne propose pas tous les capteurs nécessaires.';
        return;
    }

    stopSensors();
    startButton.disabled = true;
    cameraStatus.textContent = 'Activation en cours…';

    try {
        // Sur iPhone, cette demande doit partir directement du clic sur le bouton.
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            const permission = await DeviceOrientationEvent.requestPermission(true);
            if (permission !== 'granted') {
                throw new Error('Accès à l’orientation refusé.');
            }
        }

        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } }, audio: false
        });
        video.srcObject = stream;
        await video.play();
        cameraStatus.textContent = 'Caméra active. Tourne le téléphone pour chercher les cubes.';
        orientationStatus.textContent = 'En attente des capteurs d’orientation…';
        geoStatus.textContent = 'Recherche de la position GPS…';

        window.addEventListener('deviceorientationabsolute', updateOrientation);
        window.addEventListener('deviceorientation', updateOrientation);
        orientationTimer = setTimeout(function () {
            if (!lastOrientation) {
                orientationStatus.textContent = 'Aucune orientation reçue. Vérifie les autorisations et utilise un smartphone avec des capteurs.';
                startButton.disabled = false;
            }
        }, 5000);

        watchId = navigator.geolocation.watchPosition(updatePosition, function (error) {
            geoStatus.textContent = 'Position indisponible : ' + error.message;
            startButton.disabled = false;
        }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
    } catch (error) {
        stopSensors();
        cameraStatus.textContent = 'Démarrage impossible : ' + error.message;
    }
}

startButton.addEventListener('click', start);
window.addEventListener('pagehide', stopSensors);

window.addEventListener('resize', function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    map.invalidateSize();
    if (lastOrientation) {
        updateOrientation(lastOrientation);
    }
});

function animate() {
    renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);
