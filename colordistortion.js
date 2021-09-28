// constant, try to change them to see how it acts
const FADING_SPEED = 0.015; // initially 0.015
const INERTIA_LENGTH = 15; // initially 15
const INERTIA_DECELERATION = 0.04; // initially 0.04
const INERTIA_INTERVAL = 8; // initially 16

// get our plane element
var planeElements = document.getElementsByClassName("curtain");

// our canvas container
var canvasContainer = document.getElementById("canvas");

// could be useful to get pixel ratio
var pixelRatio = window.devicePixelRatio ? window.devicePixelRatio : 1.0;

// track the mouse positions
var mousePosition = {
    x: -10000,
    y: -10000,
};

var mouseAttr = [];
var mouseInertia = [];


/*** HANDLING OUR CANVAS TEXTURE ***/

// our mouse canvas that will act as a dynamic displacement map
var mouseCanvas = document.getElementById("mouse-coords-canvas");
var mouseCanvasContext = mouseCanvas.getContext("2d", { alpha: false });

// set our canvas size
function resizeMouseCanvas() {
    mouseCanvas.width = planeElements[0].clientWidth * pixelRatio;
    mouseCanvas.height = planeElements[0].clientHeight * pixelRatio;

    mouseCanvasContext.width = planeElements[0].clientWidth * pixelRatio;
    mouseCanvasContext.height = planeElements[0].clientHeight * pixelRatio;

    mouseCanvasContext.scale(pixelRatio, pixelRatio);
}

// we are going to draw white circles with a radial gradient
function drawGradientCircle(pointerSize, circleAttributes) {
    mouseCanvasContext.beginPath();

    var gradient = mouseCanvasContext.createRadialGradient(circleAttributes.x, circleAttributes.y, 0, circleAttributes.x, circleAttributes.y, pointerSize);

    // our gradient could go from opaque white to transparent white or from opaque white to transparent black
    // it changes the effect a bit
    gradient.addColorStop(0, 'rgba(255, 255, 255, ' + circleAttributes.opacity + ')');

    //gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

    mouseCanvasContext.fillStyle = gradient;

    mouseCanvasContext.arc(circleAttributes.x, circleAttributes.y, pointerSize, 0, 2 * Math.PI, false);
    mouseCanvasContext.fill();
    mouseCanvasContext.closePath();
}

function animateMouseCanvas() {
    // here we will handle our canvas texture animation
    var pointerSize = window.innerWidth > window.innerHeight ? Math.floor(window.innerHeight / 15) : Math.floor(window.innerWidth / 15);

    // clear scene
    mouseCanvasContext.clearRect(0, 0, mouseCanvas.width, mouseCanvas.height);

    // draw a background black rectangle
    mouseCanvasContext.beginPath();
    mouseCanvasContext.fillStyle = "black";

    mouseCanvasContext.rect(0, 0, mouseCanvas.width, mouseCanvas.height);
    mouseCanvasContext.fill();
    mouseCanvasContext.closePath();

    // draw all our mouse coords
    for (var i = 0; i < mouseAttr.length; i++) {
        drawGradientCircle(pointerSize, mouseAttr[i]);
    }

    for (var i = 0; i < mouseInertia.length; i++) {
        drawGradientCircle(pointerSize, mouseInertia[i]);
    }
}

resizeMouseCanvas();


/*** HANDLING WEBGL ***/

// set up our WebGL context and append the canvas to our wrapper
var webGLCurtain = new Curtains({
    container: "canvas"
});

// some basic parameters
// we don't need to specifiate vertexShaderID and fragmentShaderID because we already passed it via the data attributes of the plane HTML element
var params = {
    uniforms: {
        resolution: { // resolution of our plane
            name: "uResolution",
            type: "2f", // notice this is an length 2 array of floats
            value: [pixelRatio * planeElements[0].clientWidth, pixelRatio * planeElements[0].clientHeight],
        },
        mousePosition: { // our mouse position
            name: "uMousePosition",
            type: "2f", // again an array of floats
            value: [mousePosition.x, mousePosition.y],
        },
    }
}

// create our plane
var plane = webGLCurtain.addPlane(planeElements[0], params);

plane.onReady(function () {

    // on resize, update the resolution uniform
    window.addEventListener("resize", function (e) {
        plane.uniforms.resolution.value = [pixelRatio * planeElements[0].clientWidth, pixelRatio * planeElements[0].clientHeight];
        resizeMouseCanvas();
    });

    // watch for mouse move event
    document.addEventListener("mousemove", function (e) {
        handleMovement(e, plane);
    });

    document.addEventListener("touchmove", function (e) {
        handleMovement(e, plane);
    });

}).onRender(function () {

    // update our mouse coords array
    for (var i = 0; i < mouseAttr.length; i++) {
        // decrease opacity
        mouseAttr[i].opacity -= FADING_SPEED;

        if (mouseAttr[i].opacity <= 0) {
            // if element is fully transparent, remove it
            mouseAttr.splice(i, 1);
        }
    }

    // update our mouse inertia coords array
    for (var i = 0; i < mouseInertia.length; i++) {
        // decrease opacity
        mouseInertia[i].opacity -= FADING_SPEED;

        if (mouseInertia[i].opacity <= 0) {
            // if element is fully transparent, remove it
            mouseInertia.splice(i, 1);
        }
    }

    // draw our mouse coords arrays
    animateMouseCanvas();
});


// handle fake mouse coords that will act as inertia
function handleInertia(index, mouseAttributes, oldMouseAttr) {
    // decrease inertia effect
    var inertiaEffect = 1 - (index * INERTIA_DECELERATION);

    // add coords one after another
    setTimeout(function () {

        var inertiaAttributes = {
            x: mouseAttributes.x + (oldMouseAttr.velocity.x * (index + 1) * inertiaEffect),
            y: mouseAttributes.y + (oldMouseAttr.velocity.y * (index + 1) * inertiaEffect),
            opacity: 1,
            velocity: {
                x: 0,
                y: 0,
            }
        };

        mouseInertia.push(inertiaAttributes);
    }, index * INERTIA_INTERVAL);
}

// handle the mouse move event
function handleMovement(e, plane) {

    // touch event
    if (e.targetTouches) {

        mousePosition.x = e.targetTouches[0].clientX;
        mousePosition.y = e.targetTouches[0].clientY;
    }
    // mouse event
    else {
        mousePosition.x = e.clientX;
        mousePosition.y = e.clientY;
    }

    var mouseAttributes = {
        x: mousePosition.x - planeElements[0].getBoundingClientRect().left,
        y: mousePosition.y - planeElements[0].getBoundingClientRect().top,
        opacity: 1,
        velocity: {
            x: 0,
            y: 0,
        }
    }

    // handle velocity based on past values
    if (mouseAttr.length > 1) {
        mouseAttributes.velocity = {
            x: mouseAttributes.x - mouseAttr[mouseAttr.length - 1].x,
            y: mouseAttributes.y - mouseAttr[mouseAttr.length - 1].y,
        };
    }

    // now we are going to calculate inertia
    if (mouseAttr.length > 2) {

        // we are going to detect the moment when the mouse just stopped moving
        if (
            Math.abs(mouseAttributes.velocity.x) + Math.abs(mouseAttributes.velocity.y) < 10
            && Math.abs(mouseAttr[mouseAttr.length - 1].velocity.x) + Math.abs(mouseAttr[mouseAttr.length - 1].velocity.y) > 10
        ) {

            for (var i = 0; i < INERTIA_LENGTH; i++) {
                handleInertia(i, mouseAttributes, mouseAttr[mouseAttr.length - 1]);
            }

        }
        // fallback
        else if (
            Math.abs(mouseAttributes.velocity.x) + Math.abs(mouseAttributes.velocity.y) < 5
            && Math.abs(mouseAttr[mouseAttr.length - 2].velocity.x) + Math.abs(mouseAttr[mouseAttr.length - 2].velocity.y) > 30
        ) {

            for (var i = 0; i < INERTIA_LENGTH; i++) {
                handleInertia(i, mouseAttributes, mouseAttr[mouseAttr.length - 2]);
            }

        }
    }

    // push our coords to our mouse coords array
    mouseAttr.push(mouseAttributes);


    // convert our mouse/touch position to coordinates relative to the vertices of the plane
    var mouseCoords = plane.mouseToPlaneCoords(mousePosition.x, mousePosition.y);
    // update our mouse position uniform
    plane.uniforms.mousePosition.value = [mouseCoords.x, mouseCoords.y];
}