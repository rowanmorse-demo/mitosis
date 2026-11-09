// three.js with the studio-light environment, bundled into one script for render.html (render.js builds it)
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
window.THREE = THREE; window.RoomEnvironment = RoomEnvironment;
