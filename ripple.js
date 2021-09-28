/***
 This example is a port of this pen https://codepen.io/shubniggurath/pen/OEeMOd from three.js to curtains.js
 Most of the fragment shaders are borrowed from that pen. However I tweaked them a little and removed some stuff originally done in here (env map, heavy blur, noise...)
 ***/


/***
This is the class that handles the drawing of the ripples
It is done with FBOs swapping with 2 render targets
***/
class Ripples {

    constructor({
        callback = null,
        curtains = null,
        container = null,

        viscosity = 2,
        speed = 3.5,
        size = 1,

        // debug
        gui = null,
        guiParams = null,
    } = {}) {

        if (!curtains) return;

        this.curtains = curtains;

        this.params = {
            container: this.curtains.container,
            callback: callback,

            viscosity: viscosity,
            speed: speed,
            size: size,

            gui: gui,
            guiParams: guiParams,
        };

        this.mouse = {
            current: {
                x: 0,
                y: 0,
            },
            last: {
                x: 0,
                y: 0,
            },
            velocity: {
                x: 0,
                y: 0,
            },
        };

        this.debug();

        this.init();
    }

    debug() {
        if (this.params.gui && this.params.guiParams) {

            this.params.guiParams.viscosity = this.params.viscosity;
            this.params.guiParams.speed = this.params.speed;
            this.params.guiParams.size = this.params.size;

            this.ripplesGui = this.params.gui.addFolder('Render targets');
            this.ripplesGui.open();

            this.guiViscosity = this.ripplesGui.add(this.params.guiParams, 'viscosity', 1, 15);
            this.guiSpeed = this.ripplesGui.add(this.params.guiParams, 'speed', 1, 15);
            this.guiSize = this.ripplesGui.add(this.params.guiParams, 'size', 0.5, 2.5).step(0.025);

            this.guiViscosity.onChange((value) => {
                if (this.ripples) {
                    this.ripples.uniforms.viscosity.value = value;
                }
            });

            this.guiSpeed.onChange((value) => {
                if (this.ripples) {
                    this.ripples.uniforms.speed.value = value;
                }
            });

            this.guiSize.onChange((value) => {
                if (this.ripples) {
                    this.ripples.uniforms.size.value = value;
                }
            });
        }
    }

    getCanvasSizes() {
        return this.curtains.getBoundingRect();
    }

    lerp(start, end, amt) {
        return (1 - amt) * start + amt * end;
    }

    onMouseMove(e) {
        if (this.ripples) {
            // velocity is our mouse position minus our mouse last position
            this.mouse.last.x = this.mouse.current.x;
            this.mouse.last.y = this.mouse.current.y;

            let weblgMouseCoords = this.ripples.mouseToPlaneCoords(this.mouse.last.x, this.mouse.last.y);
            this.ripples.uniforms.lastMousePosition.value = [weblgMouseCoords.x, weblgMouseCoords.y];

            let updateVelocity = true;
            if (
                this.mouse.last.x === 0
                && this.mouse.last.y === 0
                && this.mouse.current.x === 0
                && this.mouse.current.y === 0
            ) {
                updateVelocity = false;
            }

            // touch event
            if (e.targetTouches) {
                this.mouse.current.x = e.targetTouches[0].clientX;
                this.mouse.current.y = e.targetTouches[0].clientY;
            }
            // mouse event
            else {
                this.mouse.current.x = e.clientX;
                this.mouse.current.y = e.clientY;
            }

            weblgMouseCoords = this.ripples.mouseToPlaneCoords(this.mouse.current.x, this.mouse.current.y);
            this.ripples.uniforms.mousePosition.value = [weblgMouseCoords.x, weblgMouseCoords.y];

            // divided by a frame duration (roughly)
            if (updateVelocity) {
                this.mouse.velocity = {
                    x: (this.mouse.current.x - this.mouse.last.x) / 16,
                    y: (this.mouse.current.y - this.mouse.last.y) / 16
                };
            }
        }
    }

    setRipplesShaders() {
        this.ripplesVs = `
            #ifdef GL_FRAGMENT_PRECISION_HIGH
            precision highp float;
            #else
            precision mediump float;
            #endif
    
            // default mandatory variables
            attribute vec3 aVertexPosition;
            attribute vec2 aTextureCoord;
    
            uniform mat4 uMVMatrix;
            uniform mat4 uPMatrix;
    
            // custom variables
            varying vec3 vVertexPosition;
            varying vec2 vTextureCoord;
    
            void main() {
    
                vec3 vertexPosition = aVertexPosition;
    
                gl_Position = uPMatrix * uMVMatrix * vec4(vertexPosition, 1.0);
    
                // varyings
                vTextureCoord = aTextureCoord;
                vVertexPosition = vertexPosition;
            }
        `;

        this.ripplesFs = `
            #ifdef GL_FRAGMENT_PRECISION_HIGH
            precision highp float;
            #else
            precision mediump float;
            #endif
    
            uniform vec2 uResolution;
            uniform vec2 uMousePosition;
            uniform vec2 uLastMousePosition;
            uniform vec2 uVelocity;
            uniform int uTime;
            uniform sampler2D uTargetTexture;
            
            uniform float uViscosity;
            uniform float uSpeed;
            uniform float uSize;
            
            varying vec3 vVertexPosition;
            varying vec2 vTextureCoord;
            
            // line distance field
            float sdLine( vec2 p, vec2 a, vec2 b ){
                float velocity = clamp(length(uVelocity), 0.5, 1.5);
                vec2 pa = p - a, ba = b - a;
                float h = clamp( dot(pa, ba)/dot(ba, ba), 0.0, 1.0 );
                return length( pa - ba*h ) / velocity;
            }
    
            
            void main() {
                float velocity = clamp(length(uVelocity), 0.1, 1.0);
                vec3 speed = vec3(vec2(uSpeed) / uResolution.xy, 0.0);
                           
                vec2 mouse = (uMousePosition + 1.0) * 0.5;
                vec2 lastMouse = (uLastMousePosition + 1.0) * 0.5;            
    
                vec4 color = texture2D(uTargetTexture, vTextureCoord);
                
                // trick given by Edan Kwan on this codepen: https://codepen.io/edankwan/pen/YzXgxxr
                // "It is always better to use line distance field instead of single point distance for ripple drawing. And it is cheap and simple."
                //float shade = smoothstep(0.02 * uSize * velocity, 0.0, length(mouse - vTextureCoord));
                float shade = smoothstep(0.02 * uSize * velocity, 0.0, sdLine(vTextureCoord, lastMouse, mouse));        
            
                vec4 texelColor = color;
                
                float d = shade * uViscosity;
                
                float top = texture2D(uTargetTexture, vTextureCoord - speed.zy, 1.0).x;
                float right = texture2D(uTargetTexture, vTextureCoord - speed.xz, 1.0).x;
                float bottom = texture2D(uTargetTexture, vTextureCoord + speed.xz, 1.0).x;
                float left = texture2D(uTargetTexture, vTextureCoord + speed.zy, 1.0).x;
                
                d += -(texelColor.y - 0.5) * 2.0 + (top + right + bottom + left - 2.0);
                d *= 0.99;
                
                // skip first frames
                d *= float(uTime > 5);
                
                d = d * 0.5 + 0.5;
                
                color = vec4(d, texelColor.x, 0.0, 1.0);
            
                gl_FragColor = color;
            }
        `;
    }

    swapPasses() {
        // swap read and write passes
        var tempFBO = this.readPass;
        this.readPass = this.writePass;
        this.writePass = tempFBO;

        // apply new texture
        this.ripplesTexture.setFromTexture(this.readPass.textures[0]);
    }

    createRipplesTexture() {
        // create a texture where we'll draw our ripples
        this.ripplesTexture = this.ripples.createTexture({
            sampler: "uTargetTexture"
        });

        return new Promise((resolve) => {
            if (this.ripplesTexture) {
                resolve();
            }
        });
    }

    init() {
        // create 2 render targets
        this.readPass = this.curtains.addRenderTarget({
            clear: false,
        });
        this.writePass = this.curtains.addRenderTarget({
            clear: false,
        });

        this.setRipplesShaders();

        let boundingRect = this.getCanvasSizes();

        this.ripplesParams = {
            vertexShader: this.ripplesVs,
            fragmentShader: this.ripplesFs,
            autoloadSources: false, // dont load our webgl canvas!!
            depthTest: false, // we need to disable the depth test in order for the ping pong shading to work
            watchScroll: false,
            uniforms: {
                mousePosition: {
                    name: "uMousePosition",
                    type: "2f",
                    value: [this.mouse.current.x, this.mouse.current.y],
                },
                lastMousePosition: {
                    name: "uLastMousePosition",
                    type: "2f",
                    value: [this.mouse.current.x, this.mouse.current.y],
                },
                velocity: {
                    name: "uVelocity",
                    type: "2f",
                    value: [this.mouse.velocity.x, this.mouse.velocity.y],
                },

                // window aspect ratio to draw a circle
                resolution: {
                    name: "uResolution",
                    type: "2f",
                    value: [boundingRect.width, boundingRect.height],
                },

                time: {
                    name: "uTime",
                    type: "1i",
                    value: -1,
                },

                viscosity: {
                    name: "uViscosity",
                    type: "1f",
                    value: this.params.viscosity,
                },
                speed: {
                    name: "uSpeed",
                    type: "1f",
                    value: this.params.speed,
                },
                size: {
                    name: "uSize",
                    type: "1f",
                    value: this.params.size,
                },
            },
        };

        this.ripples = this.curtains.addPlane(this.params.container, this.ripplesParams);

        if (this.ripples) {
            this.createRipplesTexture().then(() => {
                if (this.params.callback) {
                    this.params.callback(this.ripplesTexture);
                }
            });

            this.ripples.onReady(() => {
                // add event listeners
                window.addEventListener("mousemove", (e) => this.onMouseMove(e));
                window.addEventListener("touchmove", (e) => this.onMouseMove(e));
            }).onRender(() => {
                this.ripples.uniforms.velocity.value = [this.mouse.velocity.x, this.mouse.velocity.y];

                this.mouse.velocity = {
                    x: this.lerp(this.mouse.velocity.x, 0, 0.1),
                    y: this.lerp(this.mouse.velocity.y, 0, 0.1),
                };

                this.ripples.uniforms.velocity.value = [this.mouse.velocity.x, this.mouse.velocity.y];

                this.ripples.uniforms.time.value++;

                // update the render target
                this.writePass && this.ripples.setRenderTarget(this.writePass);
            }).onAfterRender(() => {
                // swap FBOs and update texture
                if (this.readPass && this.writePass) {
                    this.swapPasses();
                }

            }).onAfterResize(() => {
                // update our window aspect ratio uniform
                boundingRect = this.getCanvasSizes();
                this.ripples.uniforms.resolution.value = [boundingRect.width, boundingRect.height];
            });
        }
    }
}


/*** 
This is the class that renders the whole scene (tiles texture and title) and apply the texture returned by our Ripples class to create ripples
***/
class RipplesScene {

    constructor({
        viscosity = 5,
        speed = 3.5,
        size = 1,

        displacementStrength = 4,
        lightIntensity = 5,
        shadowIntensity = 2.5,
    } = {}) {

        this.params = {
            viscosity: viscosity,
            speed: speed,
            size: size,

            displacementStrength: displacementStrength,
            lightIntensity: lightIntensity,
            shadowIntensity: shadowIntensity,
        };

        this.init();
    }

    debug() {
        this.sceneGui = this.gui.addFolder('Scene');
        this.sceneGui.open();

        this.guiDisplacement = this.sceneGui.add(this.guiParams, 'displacement', 0, 5);
        this.guiLights = this.sceneGui.add(this.guiParams, 'lights', 0.1, 10);
        this.guiShadows = this.sceneGui.add(this.guiParams, 'shadows', 0.1, 10);

        this.guiBlurRipples = this.sceneGui.add(this.guiParams, 'blurRipples', true);
        this.guiShowTexture = this.sceneGui.add(this.guiParams, 'showTexture', true);
        this.guiTitleColor = this.sceneGui.addColor(this.guiParams, 'titleColor');

        this.guiDisplacement.onChange((value) => {
            if (this.scenePlane) {
                this.scenePlane.uniforms.displacementStrength.value = value;
            }
        });

        this.guiLights.onChange((value) => {
            if (this.scenePlane) {
                this.scenePlane.uniforms.lightIntensity.value = value;
            }
        });

        this.guiShadows.onChange((value) => {
            if (this.scenePlane) {
                this.scenePlane.uniforms.shadowIntensity.value = value;
            }
        });

        this.guiBlurRipples.onChange((value) => {
            if (this.scenePlane) {
                this.scenePlane.uniforms.blurRipples.value = value ? 1 : 0;
            }
        });

        this.guiShowTexture.onChange((value) => {
            if (this.scenePlane) {
                this.scenePlane.uniforms.showTexture.value = value ? 1 : 0;
            }
        });

        this.guiTitleColor.onChange((value) => {
            if (this.scenePlane) {
                this.scenePlane.uniforms.titleColor.value = value;
            }
        });
    }

    init() {
        // set up the webgl context
        this.curtains = new Curtains({
            container: "canvas",
            alpha: false, // we don't need alpha, and setting it to false will improve our text canvas texture rendering
        }).onError(() => {
            // we will add a class to the document body to display original image and title
            document.body.classList.add("no-curtains");
        }).onContextLost(() => {
            // on context lost, try to restore the context
            this.curtains.restoreContext();
        });

        this.setSceneShaders();

        // we'll be using this html element to create 2 planes
        this.sceneElement = document.getElementById("water-ripples");

        // debugging
        // DAT gui
        this.guiParams = {
            displacement: this.params.displacementStrength,
            lights: this.params.lightIntensity,
            shadows: this.params.shadowIntensity,

            blurRipples: true,
            showTexture: true,
            titleColor: [255, 255, 255],
        };

        this.gui = new dat.GUI();

        this.ripples = new Ripples({
            curtains: this.curtains,
            container: this.sceneElement,
            viscosity: this.params.viscosity || null,
            speed: this.params.speed || null,
            size: this.params.size || null,
            callback: (texture) => {
                this.createScenePlane(texture);
            },

            gui: this.gui || null,
            guiParams: this.guiParams || null,
        });

        // dat gui
        this.debug();
    }

    setSceneShaders() {
        this.sceneVs = `
            precision highp float;
            
            // default mandatory variables
            attribute vec3 aVertexPosition;
            attribute vec2 aTextureCoord;
            
            uniform mat4 uMVMatrix;
            uniform mat4 uPMatrix;
            
            // varyings
            varying vec3 vVertexPosition;
            varying vec2 vTextureCoord;
            varying vec2 vPlaneTextureCoord;
            
            // textures matrices
            uniform mat4 planeTextureMatrix;
    
            void main() {
                gl_Position = uPMatrix * uMVMatrix * vec4(aVertexPosition, 1.0);
                
                // varyings
                vTextureCoord = aTextureCoord;
                vPlaneTextureCoord = (planeTextureMatrix * vec4(aTextureCoord, 0.0, 1.0)).xy;
                vVertexPosition = aVertexPosition;
            }
        `;

        this.sceneFs = `
            precision highp float;
            
            // varyings
            varying vec3 vVertexPosition;
            varying vec2 vTextureCoord;
            varying vec2 vPlaneTextureCoord;
            
            uniform sampler2D uRippleTexture;
            uniform sampler2D planeTexture;
            uniform sampler2D titleTexture;
            
            uniform vec2 uResolution;
            
            uniform float uDisplacementStrength;
            uniform float uLightIntensity;
            uniform float uShadowIntensity;
            
            uniform float uBlurRipples;
            uniform float uShowTexture;
            uniform vec3 uTitleColor;
            
            
            // Holy fuck balls, fresnel!
            const float bias = 0.2;
            const float scale = 10.0;
            const float power = 10.1;
            
            // taken from https://github.com/Jam3/glsl-fast-gaussian-blur
            vec4 blur5(sampler2D image, vec2 uv, vec2 resolution, vec2 direction) {
                vec4 color = vec4(0.0);
                vec2 off1 = vec2(1.3333333333333333) * direction;
                color += texture2D(image, uv) * 0.29411764705882354;
                color += texture2D(image, uv + (off1 / resolution)) * 0.35294117647058826;
                color += texture2D(image, uv - (off1 / resolution)) * 0.35294117647058826;
                return color;
            }
            
            float bumpMap(vec2 uv, float height, inout vec3 colormap) {
                vec3 shade;
                // branching on an uniform is OK
                if(uBlurRipples == 1.0) {
                    shade = blur5(uRippleTexture, vTextureCoord, uResolution, vec2(1.0, 1.0)).rgb;
                }
                else {
                    shade = texture2D(uRippleTexture, vTextureCoord).rgb;
                }
                
                return 1.0 - shade.r * height;
            }
            
            float bumpMap(vec2 uv, float height) {
                vec3 colormap;
                return bumpMap(uv, height, colormap);
            }
    
            // add bump map, reflections and lightnings to the ripples render target texture
            vec4 renderPass(vec2 uv, inout float distortion) {
                vec3 surfacePos = vec3(uv, 0.0);
                vec3 ray = normalize(vec3(uv, 1.0));
    
                vec3 lightPos = vec3( 2.0, 3.0, -3.0);
                vec3 normal = vec3(0.0, 0.0, -1);
                
                vec2 sampleDistance = vec2(0.005, 0.0);
                
                vec3 colormap;
                
                float fx = bumpMap(sampleDistance.xy, 0.2);
                float fy = bumpMap(sampleDistance.yx, 0.2);
                float f = bumpMap(vec2(0.0), 0.2, colormap);
                
                distortion = f;
                
                fx = (fx - f) / sampleDistance.x;
                fy = (fy - f) / sampleDistance.x;
                normal = normalize(normal + vec3(fx, fy, 0.0) * 0.2);
                
                // Holy fuck balls, fresnel!
                float shade = bias + (scale * pow(1.0 + dot(normalize(surfacePos - vec3(uv, -3.0)), normal), power));
                
                vec3 lightV = lightPos - surfacePos;
                float lightDist = max(length(lightV), 0.001);
                lightV /= lightDist;
                
                // light color based on light intensity
                vec3 lightColor = vec3(1.0 - uLightIntensity / 20.0);
                
                float shininess = 0.1;
                // brightness also based on light intensity
                float brightness = 1.0 - uLightIntensity / 40.0;
                
                float falloff = 0.1;
                // finally attenuation based on light intensity as well
                float attenuation = (0.75 + uLightIntensity / 40.0) / (1.0 + lightDist * lightDist * falloff);
                
                float diffuse = max(dot(normal, lightV), 0.0);
                float specular = pow(max(dot( reflect(-lightV, normal), -ray), 0.0), 15.0) * shininess;
                
                vec3 reflect_ray = reflect(vec3(uv, 1.0), normal * 1.0);
                vec3 texCol = (vec3(0.5) * brightness);
                
                float metalness = (1.0 - colormap.x);
                metalness *= metalness;
                
                vec3 color = (texCol * (diffuse * vec3(0.9) * 2.0 + 0.5) + lightColor * specular * f * 2.0 * metalness) * attenuation * 2.0;
    
                return vec4(color, 1.0);
            }
    
    
            void main() {
                vec4 color = vec4(1.0);
                
                float distortion;
                vec4 reflections = renderPass(vTextureCoord, distortion);            
                
                vec4 ripples = vec4(0.16);            
                ripples += distortion * 0.1 - 0.1;
                ripples += reflections * 0.7;
                
                
                vec2 textureCoords = vTextureCoord + distortion * (uDisplacementStrength / 250.0);
                vec2 planeTextureCoords = vPlaneTextureCoord + distortion * (uDisplacementStrength / 250.0);
                
                vec4 texture = texture2D(planeTexture, planeTextureCoords);
                vec4 title = texture2D(titleTexture, textureCoords);
                title.rgb *= vec3(uTitleColor.r / 255.0, uTitleColor.g / 255.0, uTitleColor.b / 255.0);
                
                // mix texture and title
                color = mix(vec4(0.05, 0.05, 0.05, 1.0), texture, uShowTexture);
                color = mix(color, title, title.a);
    
                
                // add fake lights & shadows
                float lights = max(0.0, ripples.r - 0.5);
                color.rgb += lights * (uLightIntensity / 10.0);
                
                float shadow = max(0.0, 1.0 - (ripples.r + 0.5));
                color.rgb -= shadow * (uShadowIntensity / 10.0);
                
                gl_FragColor = color;
            }
        `;
    }

    writeTitleCanvas(canvas) {
        const title = document.getElementById("water-ripples-title").querySelector("h1");
        const titleStyle = window.getComputedStyle(title);

        let titleTopPosition = title.offsetTop * this.curtains.pixelRatio;
        // adjust small offset due to font interpretation?
        titleTopPosition += title.clientHeight * this.curtains.pixelRatio * 0.1;

        const planeBoundinRect = this.scenePlane.getBoundingRect();

        const htmlPlaneWidth = planeBoundinRect.width;
        const htmlPlaneHeight = planeBoundinRect.height;

        // set sizes
        canvas.width = htmlPlaneWidth;
        canvas.height = htmlPlaneHeight;
        let context = canvas.getContext("2d");

        context.width = htmlPlaneWidth;
        context.height = htmlPlaneHeight;

        // draw our title with the original style
        context.fillStyle = titleStyle.color;
        context.font = parseFloat(titleStyle.fontWeight) + " " + parseFloat(titleStyle.fontSize) * this.curtains.pixelRatio + "px " + titleStyle.fontFamily;
        context.fontStyle = titleStyle.fontStyle;

        context.textAlign = "center";

        // vertical alignment
        context.textBaseline = "top";
        context.fillText(title.innerText, htmlPlaneWidth / 2, titleTopPosition);

        if (this.scenePlane.textures && this.scenePlane.textures.length > 1) {
            this.scenePlane.textures[1].resize();
            this.scenePlane.textures[1].needUpdate();
        }
    }

    createScenePlane(rippleTexture) {
        // next we will create the plane that will display our result
        let curtainsBBox = this.curtains.getBoundingRect();

        const params = {
            vertexShader: this.sceneVs,
            fragmentShader: this.sceneFs,
            uniforms: {
                resolution: {
                    name: "uResolution",
                    type: "2f",
                    value: [curtainsBBox.width, curtainsBBox.height],
                },

                displacementStrength: {
                    name: "uDisplacementStrength",
                    type: "1f",
                    value: this.params.displacementStrength,
                },
                lightIntensity: {
                    name: "uLightIntensity",
                    type: "1f",
                    value: this.params.lightIntensity,
                },
                shadowIntensity: {
                    name: "uShadowIntensity",
                    type: "1f",
                    value: this.params.shadowIntensity,
                },

                blurRipples: {
                    name: "uBlurRipples",
                    type: "1f",
                    value: 1,
                },

                showTexture: {
                    name: "uShowTexture",
                    type: "1f",
                    value: 1,
                },
                titleColor: {
                    name: "uTitleColor",
                    type: "3f",
                    value: [255, 255, 255],
                },
            }
        };

        this.scenePlane = this.curtains.addPlane(this.sceneElement, params);

        // if the plane has been created
        if (this.scenePlane) {
            const canvas = document.createElement("canvas");

            canvas.setAttribute("data-sampler", "titleTexture");
            canvas.style.display = "none";

            this.scenePlane.loadCanvas(canvas);

            this.scenePlane.onLoading((texture) => {
                texture.shouldUpdate = false;
                if (this.scenePlane.canvases && this.scenePlane.canvases.length > 0) {
                    // title
                    if (document.fonts) {
                        document.fonts.ready.then(() => {
                            this.writeTitleCanvas(canvas);
                        });
                    }
                    else {
                        setTimeout(() => {
                            this.writeTitleCanvas(canvas);
                        }, 750);
                    }
                }

            }).onReady(() => {

                // create a texture that will hold our flowmap
                this.scenePlane.createTexture({
                    sampler: "uRippleTexture",
                    fromTexture: rippleTexture // set it based on our ripples plane's texture
                });

            }).onAfterResize(() => {
                curtainsBBox = this.curtains.getBoundingRect();
                this.scenePlane.uniforms.resolution.value = [curtainsBBox.width, curtainsBBox.height];

                this.writeTitleCanvas(canvas);
            });
        }
    }
}


window.addEventListener("load", () => {
    const rippleScene = new RipplesScene({
        viscosity: 1,
        speed: 5,
        size: 1,

        displacementStrength: 2,
        lightIntensity: 5,
        shadowIntensity: 1,
    });
});