/**
 * Contrôleur des trois modes de caméra de Flight Explorer 3D :
 *
 *  1. "global"  — Navigation libre autour du globe (vue globale).
 *  2. "chase"   — Vue extérieure derrière et légèrement au-dessus de l'avion,
 *                 qui accompagne son déplacement et son cap sans trembler.
 *  3. "cockpit" — Vue cockpit virtuelle (simulée) placée à l'avant de l'appareil,
 *                 avec rotation du regard à la souris / au doigt et option de
 *                 suivi par capteur d'orientation du smartphone.
 */
import {
  Cartesian3,
  Ellipsoid,
  HeadingPitchRange,
  HeadingPitchRoll,
  Math as CesiumMath,
  Matrix4,
  Transforms,
} from 'cesium';
import { SETTINGS } from '../config/settings.js';
import { destinationPoint, interpolateHeading, interpolatePositions } from '../utils/flightUtils.js';

const scratchTransform = new Matrix4();
const scratchOffset = new HeadingPitchRange();

/**
 * @param {import('cesium').Viewer} viewer
 * @param {{
 *   aircraftLayer: ReturnType<import('./aircraft.js').createAircraftLayer>,
 *   onOrientationStatus?: (status: { active: boolean, message: string }) => void
 * }} options
 */
export function createCameraController(viewer, { aircraftLayer, onOrientationStatus } = {}) {
  const { camera, scene } = viewer;
  const controller = scene.screenSpaceCameraController;

  let mode = 'global';
  let trackedId = null;

  // État lissé de l'avion suivi (évite les tremblements de caméra).
  let smoothed = null;

  // Décalages contrôlés par l'utilisateur en vue extérieure (chase) ou cockpit.
  let chaseYawDeg = 0;
  let chasePitchDeg = SETTINGS.camera.chase.pitchDeg;
  let chaseRangeM = SETTINGS.camera.chase.rangeM;

  let cockpitYawDeg = 0;
  let cockpitPitchDeg = -3;
  let cockpitRollDeg = 0;

  // Capteur d'orientation du smartphone (vue cockpit).
  let orientationActive = false;
  let orientationReference = null;
  let orientationListener = null;

  // Gestion du glisser-déposer (souris / tactile) pour tourner le regard.
  let pointerDown = false;
  let lastPointerX = 0;
  let lastPointerY = 0;

  const canvas = scene.canvas;

  function onPointerDown(event) {
    if (mode === 'global') return;
    pointerDown = true;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
  }

  function onPointerMove(event) {
    if (!pointerDown || mode === 'global') return;
    const dx = event.clientX - lastPointerX;
    const dy = event.clientY - lastPointerY;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;

    if (mode === 'chase') {
      chaseYawDeg = ((chaseYawDeg + dx * 0.35) % 360 + 360) % 360;
      chasePitchDeg = Math.max(-75, Math.min(15, chasePitchDeg - dy * 0.25));
    } else if (mode === 'cockpit') {
      cockpitYawDeg = Math.max(-140, Math.min(140, cockpitYawDeg + dx * 0.28));
      cockpitPitchDeg = Math.max(-65, Math.min(45, cockpitPitchDeg - dy * 0.22));
    }
  }

  function onPointerUp() {
    pointerDown = false;
  }

  function onWheel(event) {
    if (mode !== 'chase') return;
    event.preventDefault();
    const factor = event.deltaY > 0 ? 1.12 : 0.89;
    chaseRangeM = Math.max(
      SETTINGS.camera.chase.minRangeM,
      Math.min(SETTINGS.camera.chase.maxRangeM, chaseRangeM * factor),
    );
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  /** Libère tout verrouillage de caméra et rend la main aux contrôles Cesium. */
  function releaseCameraLock() {
    camera.lookAtTransform(Matrix4.IDENTITY);
    controller.enableInputs = true;
    aircraftLayer.setModelVisible(true);
  }

  /** Calcule une position et un cap lissés pour l'avion suivi. */
  function getSmoothedAircraftState(id) {
    const raw = aircraftLayer.getDisplayState(id);
    if (!raw) return null;
    const targetHeading = raw.headingDeg ?? 0;

    if (!smoothed || smoothed.id !== id) {
      smoothed = {
        id,
        lat: raw.lat,
        lon: raw.lon,
        altitudeM: raw.altitudeM,
        headingDeg: targetHeading,
        pitchDeg: computeFlightPitchDeg(raw.data),
      };
      return smoothed;
    }

    const alpha = SETTINGS.camera.smoothing;
    const pos = interpolatePositions(smoothed, raw, alpha);
    smoothed.lat = pos.lat;
    smoothed.lon = pos.lon;
    smoothed.altitudeM = pos.altitudeM;
    smoothed.headingDeg = interpolateHeading(smoothed.headingDeg, targetHeading, alpha);
    const targetPitch = computeFlightPitchDeg(raw.data);
    smoothed.pitchDeg = smoothed.pitchDeg + (targetPitch - smoothed.pitchDeg) * alpha;
    return smoothed;
  }

  /** Estime une légère assiette (pitch) à partir du taux de montée/descente. */
  function computeFlightPitchDeg(aircraft) {
    if (!aircraft || aircraft.onGround || !Number.isFinite(aircraft.verticalRateFpm)) return 0;
    return Math.max(-8, Math.min(10, (aircraft.verticalRateFpm / 1500) * 4));
  }

  /** Rejoint en douceur un avion en vue globale (sans verrouiller la caméra). */
  function flyToAircraftOverview(id, { duration = 1.6 } = {}) {
    const state = aircraftLayer.getDisplayState(id);
    if (!state) return;
    releaseCameraLock();

    const currentHeight = camera.positionCartographic?.height ?? SETTINGS.camera.selectFlyHeightM;
    const targetHeight = Math.max(
      state.altitudeM + 8_000,
      Math.min(currentHeight, SETTINGS.camera.selectFlyHeightM + state.altitudeM),
    );
    // On place la caméra légèrement au sud de l'avion avec une inclinaison de -35°.
    const offsetSouth = destinationPoint(state.lat, state.lon, 180, (targetHeight - state.altitudeM) * 1.15);
    camera.flyTo({
      destination: Cartesian3.fromDegrees(offsetSouth.lon, offsetSouth.lat, targetHeight),
      orientation: {
        heading: 0,
        pitch: CesiumMath.toRadians(-38),
        roll: 0,
      },
      duration,
    });
  }

  // -------------------------------------------------------------------------
  // Capteur d'orientation du smartphone (vue cockpit)
  // -------------------------------------------------------------------------

  async function enableDeviceOrientation() {
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
      onOrientationStatus?.({
        active: false,
        message: "Capteur d'orientation non disponible sur cet appareil. Utilisez le glisser tactile.",
      });
      return false;
    }

    // iOS 13+ exige une demande de permission déclenchée par un geste utilisateur.
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission !== 'granted') {
          onOrientationStatus?.({
            active: false,
            message: 'Permission refusée pour le capteur. Le mode tactile reste actif.',
          });
          return false;
        }
      } catch (error) {
        console.warn('[camera] Permission capteur refusée ou erreur :', error);
        onOrientationStatus?.({
          active: false,
          message: "Impossible d'activer le capteur d'orientation. Mode tactile actif.",
        });
        return false;
      }
    }

    orientationReference = null;
    let receivedValidSample = false;

    orientationListener = (event) => {
      if (event.alpha === null && event.beta === null) return;
      receivedValidSample = true;
      const alpha = event.alpha ?? 0;
      const beta = event.beta ?? 0;

      if (!orientationReference) {
        orientationReference = { alpha, beta };
      }

      let dYaw = -(alpha - orientationReference.alpha);
      if (dYaw > 180) dYaw -= 360;
      if (dYaw < -180) dYaw += 360;
      const dPitch = beta - orientationReference.beta;

      cockpitYawDeg = Math.max(-120, Math.min(120, dYaw));
      cockpitPitchDeg = Math.max(-60, Math.min(45, dPitch * 0.7));
    };

    window.addEventListener('deviceorientation', orientationListener);
    orientationActive = true;
    onOrientationStatus?.({
      active: true,
      message: 'Orientation du smartphone active (bougez l’appareil ou glissez avec le doigt).',
    });

    // Sur ordinateur de bureau, l'événement existe mais n'émet aucune valeur.
    setTimeout(() => {
      if (orientationActive && !receivedValidSample) {
        onOrientationStatus?.({
          active: true,
          message: 'Aucun gyroscope détecté : utilisez la souris ou le doigt pour regarder autour de vous.',
        });
      }
    }, 1200);

    return true;
  }

  function disableDeviceOrientation(silent = false) {
    if (orientationListener) {
      window.removeEventListener('deviceorientation', orientationListener);
      orientationListener = null;
    }
    orientationActive = false;
    orientationReference = null;
    if (!silent) {
      onOrientationStatus?.({
        active: false,
        message: 'Capteur désactivé. Glissez pour orienter le regard.',
      });
    }
  }

  return {
    get mode() {
      return mode;
    },
    get trackedId() {
      return trackedId;
    },
    get orientationActive() {
      return orientationActive;
    },

    /**
     * Définit l'avion suivi et le mode de caméra.
     * @param {string|null} aircraftId
     * @param {'global'|'chase'|'cockpit'} nextMode
     * @param {{ flyOnGlobalSelect?: boolean }} [options]
     */
    setTracking(aircraftId, nextMode = mode, { flyOnGlobalSelect = false } = {}) {
      const targetChanged = aircraftId !== trackedId;
      const previousMode = mode;

      trackedId = aircraftId;
      mode = aircraftId ? nextMode : 'global';

      if (targetChanged) {
        smoothed = null;
        chaseYawDeg = 0;
        chasePitchDeg = SETTINGS.camera.chase.pitchDeg;
        chaseRangeM = SETTINGS.camera.chase.rangeM;
        cockpitYawDeg = 0;
        cockpitPitchDeg = -3;
        cockpitRollDeg = 0;
      }

      if (mode !== 'cockpit' && orientationActive) {
        disableDeviceOrientation(true);
      }

      if (!trackedId || mode === 'global') {
        releaseCameraLock();
        if (trackedId && (flyOnGlobalSelect || previousMode !== 'global')) {
          flyToAircraftOverview(trackedId);
        }
        return;
      }

      camera.cancelFlight();

      if (mode === 'chase') {
        controller.enableInputs = false;
        aircraftLayer.setModelVisible(true);
      } else if (mode === 'cockpit') {
        camera.lookAtTransform(Matrix4.IDENTITY);
        controller.enableInputs = false;
        // On masque le modèle 3D pour que le nez ne masque pas la vue cockpit.
        aircraftLayer.setModelVisible(false);
        cockpitYawDeg = 0;
        cockpitPitchDeg = -3;
      }
    },

    /** Réinitialise l'angle d'observation dans la vue courante (extérieure ou cockpit). */
    resetViewOffset() {
      chaseYawDeg = 0;
      chasePitchDeg = SETTINGS.camera.chase.pitchDeg;
      chaseRangeM = SETTINGS.camera.chase.rangeM;
      cockpitYawDeg = 0;
      cockpitPitchDeg = -3;
      orientationReference = null;
      if (trackedId && mode === 'global') {
        flyToAircraftOverview(trackedId);
      }
    },

    /** Active ou désactive le suivi d'orientation du smartphone en vue cockpit. */
    async toggleDeviceOrientation() {
      if (orientationActive) {
        disableDeviceOrientation(false);
        return false;
      }
      return enableDeviceOrientation();
    },

    /**
     * Appelée à chaque image (après aircraftLayer.update) pour maintenir le suivi
     * de la caméra en vue extérieure ("chase") ou cockpit ("cockpit").
     */
    update() {
      if (!trackedId || mode === 'global') return;

      const state = getSmoothedAircraftState(trackedId);
      if (!state) return;

      const groundSafeAltM = state.altitudeM < 5 ? 8 : state.altitudeM;

      if (mode === 'chase') {
        const center = Cartesian3.fromDegrees(state.lon, state.lat, groundSafeAltM);
        Transforms.eastNorthUpToFixedFrame(center, Ellipsoid.WGS84, scratchTransform);
        scratchOffset.heading = CesiumMath.toRadians(state.headingDeg + chaseYawDeg);
        scratchOffset.pitch = CesiumMath.toRadians(chasePitchDeg);
        scratchOffset.range = chaseRangeM;
        camera.lookAtTransform(scratchTransform, scratchOffset);
      } else if (mode === 'cockpit') {
        const nosePoint = destinationPoint(
          state.lat,
          state.lon,
          state.headingDeg,
          SETTINGS.camera.cockpit.forwardOffsetM,
        );
        const cockpitPos = Cartesian3.fromDegrees(
          nosePoint.lon,
          nosePoint.lat,
          groundSafeAltM + SETTINGS.camera.cockpit.upOffsetM,
        );
        camera.setView({
          destination: cockpitPos,
          orientation: new HeadingPitchRoll(
            CesiumMath.toRadians(state.headingDeg + cockpitYawDeg),
            CesiumMath.toRadians(state.pitchDeg + cockpitPitchDeg),
            CesiumMath.toRadians(cockpitRollDeg),
          ),
        });
      }
    },

    destroy() {
      disableDeviceOrientation(true);
      releaseCameraLock();
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    },
  };
}

