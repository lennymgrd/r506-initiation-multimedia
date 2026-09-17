function afficherCarte(latitude, longitude) {

    var map = L.map('map').setView([latitude, longitude], 13);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);


    //marqueur position actuelle
    L.marker([latitude, longitude]).addTo(map);

    //marqueur centre ville Nice
    recupererNice(map);
    // tracé du triangle
    afficherTriangleBermudes(map);


}

function recupererNice(map) {

    let xhr = new XMLHttpRequest();

    xhr.open(
        'GET',
        'https://geo.api.gouv.fr/communes?nom=Nice&fields=nom,centre&format=json&geometry=centre'
    );

    xhr.responseType = 'json';

    xhr.onload = function() {

        if (xhr.status !== 200) return;

        var nice = xhr.response[0];

        var longitudeNice = nice.centre.coordinates[0];
        var latitudeNice = nice.centre.coordinates[1];

        L.marker([latitudeNice, longitudeNice]).addTo(map);

    };

    xhr.send();
}

function afficherTriangleBermudes(map) {

    var triangleBermudes = [
        [25.7617, -80.1918],
        [32.3078, -64.7505],
        [18.4655, -66.1057]
    ];

    L.polygon(triangleBermudes, {
        color: 'red'
    }).addTo(map);
}