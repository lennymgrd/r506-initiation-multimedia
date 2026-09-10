var options = {
    enableHighAccuracy: true,
    timeout: 5000,
    maximumAge: 0,
};



function successCurrent(pos) {

    var crd = pos.coords;
    var timestamp = new Date(pos.timestamp).toLocaleString();

    document.getElementById("positionActuelle").innerHTML = `
        Votre position actuelle est :<br>
        Latitude : ${crd.latitude}<br>
        Longitude : ${crd.longitude}<br>
        Altitude : ${crd.altitude}<br>
        Précision : ${crd.accuracy} mètres<br>
        Vitesse : ${crd.speed} m/s<br>
        Nous sommes le ${timestamp}.
    `;
}


function errorCurrent(err) {
    document.getElementById("positionActuelle").innerHTML =
        `ERREUR (${err.code}) : ${err.message}`;
}



function successWatch(pos) {

    var crd = pos.coords;
    var timestamp = new Date(pos.timestamp).toLocaleString();

    document.getElementById("positionSuivie").innerHTML = `
        Votre position suivie est :<br>
        Latitude : ${crd.latitude}<br>
        Longitude : ${crd.longitude}<br>
        Altitude : ${crd.altitude}<br>
        Précision : ${crd.accuracy} mètres<br>
        Vitesse : ${crd.speed} m/s<br>
        Nous sommes le ${timestamp}.
    `;
}



function errorWatch(err) {
    document.getElementById("positionSuivie").innerHTML =
        `ERREUR (${err.code}) : ${err.message}`;
}


navigator.geolocation.getCurrentPosition(
    successCurrent,
    errorCurrent,
    options
);

var watchId = navigator.geolocation.watchPosition(
    successWatch,
    errorWatch,
    options
);