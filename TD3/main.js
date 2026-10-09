import * as THREE from 'three';

// Exercice 1 : une Terre en 3D et une carte Leaflet.
const container3D = document.getElementById('scene3d');
const geoStatus = document.getElementById('geo-status');
const countriesStatus = document.getElementById('countries-status');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
    60, container3D.clientWidth / container3D.clientHeight, 0.1, 1000
);
camera.position.z = 3;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(container3D.clientWidth, container3D.clientHeight);
container3D.appendChild(renderer.domElement);
scene.add(new THREE.AmbientLight(0xffffff, 2));

// La Terre et ses marqueurs tournent ensemble.
const earthGroup = new THREE.Group();
scene.add(earthGroup);

const earthTexture = new THREE.TextureLoader().load('textures/earth.jpg');
earthTexture.colorSpace = THREE.SRGBColorSpace;
const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 64),
    new THREE.MeshStandardMaterial({ map: earthTexture })
);
earthGroup.add(earth);

// Y pointe vers le nord. Le signe de Z correspond à la texture de la sphère.
function latLonToXYZ(latitude, longitude, radius) {
    const lat = THREE.MathUtils.degToRad(latitude);
    const lon = THREE.MathUtils.degToRad(longitude);

    return new THREE.Vector3(
        radius * Math.cos(lat) * Math.cos(lon),
        radius * Math.sin(lat),
        -radius * Math.cos(lat) * Math.sin(lon)
    );
}

function centerEarth(latitude, longitude) {
    // Placer le point face à la caméra, en gardant le nord vers le haut.
    earthGroup.rotation.set(
        THREE.MathUtils.degToRad(latitude),
        -THREE.MathUtils.degToRad(longitude) - Math.PI / 2,
        0
    );
}

centerEarth(46, 2);

// Leaflet -> 3D : clic sur la carte ou sur un marqueur.
const map = L.map('map').setView([20, 0], 2);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

map.on('click', function (event) {
    centerEarth(event.latlng.lat, event.latlng.lng);
});

// Géolocalisation : marqueur rouge sur la Terre et sur la carte.
if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(function (position) {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;

        const marker = new THREE.Mesh(
            new THREE.SphereGeometry(0.025, 16, 16),
            new THREE.MeshBasicMaterial({ color: 0xff0000 })
        );
        marker.position.copy(latLonToXYZ(latitude, longitude, 1.03));
        earthGroup.add(marker);

        L.circleMarker([latitude, longitude], {
            radius: 8, color: 'red', fillOpacity: 1
        }).addTo(map).bindPopup('Ma position').on('click', function () {
            centerEarth(latitude, longitude);
        });

        centerEarth(latitude, longitude);
        geoStatus.textContent = 'Ma position : ' + latitude.toFixed(4) + ', ' + longitude.toFixed(4);
    }, function () {
        geoStatus.textContent = 'Position indisponible. Autorise la géolocalisation pour afficher ton marqueur.';
    }, { enableHighAccuracy: true, timeout: 10000 });
} else {
    geoStatus.textContent = 'La géolocalisation est indisponible dans ce navigateur.';
}

// Pays : coordonnées et drapeaux venant de REST Countries.
const countryMarkers = [];
const countryNames = ['France', 'Brazil', 'Japan', 'Canada', 'Australia'];

function addCountry(country) {
    const latitude = country.latlng[0];
    const longitude = country.latlng[1];
    const name = country.name.common;

    const flagTexture = new THREE.TextureLoader().load(country.flags.png);
    flagTexture.colorSpace = THREE.SRGBColorSpace;
    // Le même drapeau est appliqué sur les six faces du cube.
    const flag = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.16, 0.16),
        new THREE.MeshStandardMaterial({ map: flagTexture })
    );
    flag.position.copy(latLonToXYZ(latitude, longitude, 1.16));
    earthGroup.add(flag);
    countryMarkers.push(flag);

    // textContent évite d'interpréter le nom reçu comme du HTML.
    const label = document.createElement('span');
    label.textContent = name;
    const leafletMarker = L.marker([latitude, longitude])
        .addTo(map).bindPopup(label);

    leafletMarker.on('click', function () {
        centerEarth(latitude, longitude);
    });

    flag.userData = { latitude, longitude, leafletMarker };
}

async function loadCountries() {
    let countries;

    try {
        const response = await fetch('https://restcountries.com/v3.1/all?fields=name,latlng,flags', {
            signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) {
            throw new Error('REST Countries indisponible');
        }
        countries = await response.json();
        if (!Array.isArray(countries)) {
            throw new Error('Ancienne API REST Countries désactivée');
        }
        countriesStatus.textContent = 'Pays chargés depuis REST Countries.';
    } catch (error) {
        // L'ancienne API du cours peut être indisponible : cinq pays en secours.
        const response = await fetch('countries.json');
        if (!response.ok) {
            throw new Error('Fichier de secours indisponible');
        }
        countries = await response.json();
        countriesStatus.textContent = 'REST Countries indisponible : cinq pays chargés depuis le fichier local.';
    }

    countries.forEach(function (country) {
        if (countryNames.includes(country.name.common)) {
            addCountry(country);
        }
    });
}

loadCountries().catch(function (error) {
    countriesStatus.textContent = 'Impossible de charger les pays.';
    console.error(error);
});

// 3D -> Leaflet : un rayon permet de sélectionner un cube.
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function selectCountry(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    scene.updateMatrixWorld(true);
    raycaster.setFromCamera(mouse, camera);
    // Inclure la Terre empêche de cliquer sur un cube caché derrière elle.
    const intersections = raycaster.intersectObjects([earth, ...countryMarkers]);

    if (intersections.length > 0 && intersections[0].object !== earth) {
        const country = intersections[0].object.userData;
        map.setView([country.latitude, country.longitude], 5, { animate: false });
        country.leafletMarker.openPopup();
    }
}

// Faire tourner la Terre en glissant avec la souris ou le doigt.
const canvas = renderer.domElement;
let pointer;
let dragging = false;

canvas.addEventListener('pointerdown', function (event) {
    if (event.button !== 0 || !event.isPrimary) {
        return;
    }
    pointer = {
        id: event.pointerId,
        startX: event.clientX, startY: event.clientY,
        x: event.clientX, y: event.clientY
    };
    dragging = false;
    canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', function (event) {
    if (!pointer || event.pointerId !== pointer.id) {
        return;
    }
    // Quelques pixels de tolérance permettent de cliquer sans tourner la Terre.
    if (Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > 5) {
        dragging = true;
    }
    if (dragging) {
        earthGroup.rotation.y += (event.clientX - pointer.x) * 0.005;
        earthGroup.rotation.x = THREE.MathUtils.clamp(
            earthGroup.rotation.x + (event.clientY - pointer.y) * 0.005,
            -Math.PI / 2, Math.PI / 2
        );
    }
    pointer.x = event.clientX;
    pointer.y = event.clientY;
});

canvas.addEventListener('pointerup', function (event) {
    if (!pointer || event.pointerId !== pointer.id) {
        return;
    }
    // Un glissement ne doit pas sélectionner un pays à la fin du mouvement.
    if (!dragging) {
        selectCountry(event);
    }
    pointer = undefined;
    canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener('lostpointercapture', function () {
    pointer = undefined;
    dragging = false;
});

function resize() {
    camera.aspect = container3D.clientWidth / container3D.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container3D.clientWidth, container3D.clientHeight);
    map.invalidateSize();
}

window.addEventListener('resize', resize);

function animate(time) {
    // Les cubes tournent sur eux-mêmes, en restant au-dessus de leur pays.
    countryMarkers.forEach(function (cube) {
        cube.rotation.x = time * 0.0004;
        cube.rotation.y = time * 0.0007;
    });
    renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);
