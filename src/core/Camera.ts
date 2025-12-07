import { vec3, mat4 } from 'gl-matrix';

/**
 * OrbitCamera - Custom camera controller without Three.js dependency
 * Provides orbit, pan, and zoom controls similar to Three.js OrbitControls
 */
export class OrbitCamera {
    // Camera state
    public position: vec3 = vec3.create();
    public target: vec3 = vec3.fromValues(0, 0, 0);
    public up: vec3 = vec3.fromValues(0, 1, 0);
    
    // Limits
    public minDistance: number = 10.0;
    public maxDistance: number = 25.0;
    public minElevation: number = 0.01; // almost straight down
    public maxElevation: number = Math.PI - 0.01; // almost straight up
    
    // Spherical coordinates (for orbit) - initialize to middle of distance range
    private distance: number = (10.0 + 25.0) / 2; // 17.5
    private azimuth: number = 0; // horizontal angle (radians)
    private elevation: number = Math.PI / 4; // vertical angle (radians)
    
    // Damping
    public enableDamping: boolean = true;
    private _dampingFactor: number = 0.2;
    
    // Public getter/setter for damping
    public get damping(): number { return this._dampingFactor; }
    public set damping(value: number) { this._dampingFactor = value; }
    
    // Sensitivity
    public rotateSpeed: number = 2.0;
    public panSpeed: number = 2.0;
    public zoomSpeed: number = 2.9;
    
    // View and projection matrices
    public viewMatrix: mat4 = mat4.create();
    public projectionMatrix: mat4 = mat4.create();
    
    // Projection parameters
    public fov: number = 45 * (Math.PI / 180);
    public aspect: number = 1.0;
    public near: number = 0.01;
    public far: number = 500;
    
    // Internal state for damping
    private targetAzimuth: number = 0;
    private targetElevation: number = Math.PI / 4;
    private targetDistance: number = (10.0 + 25.0) / 2; // 17.5
    private targetCenter: vec3 = vec3.fromValues(0, 0, 0);
    
    // Mouse interaction state
    private isRotating: boolean = false;
    private isPanning: boolean = false;
    private lastMouseX: number = 0;
    private lastMouseY: number = 0;
    
    constructor(position: vec3, target: vec3) {
        this.target = vec3.clone(target);
        vec3.copy(this.targetCenter, target);
        
        // Calculate initial spherical coordinates from position
        const offset = vec3.create();
        vec3.subtract(offset, position, target);
        this.distance = vec3.length(offset);
        this.targetDistance = this.distance;
        
        // Calculate azimuth and elevation
        this.azimuth = Math.atan2(offset[0], offset[2]);
        this.elevation = Math.acos(offset[1] / this.distance);
        this.targetAzimuth = this.azimuth;
        this.targetElevation = this.elevation;
        
        this.updatePosition();
        this.updateMatrices();
    }
    
    /**
     * Update camera position from spherical coordinates
     */
    private updatePosition(): void {
        const sinElevation = Math.sin(this.elevation);
        const cosElevation = Math.cos(this.elevation);
        
        this.position[0] = this.target[0] + this.distance * sinElevation * Math.sin(this.azimuth);
        this.position[1] = this.target[1] + this.distance * cosElevation;
        this.position[2] = this.target[2] + this.distance * sinElevation * Math.cos(this.azimuth);
    }
    
    /**
     * Update view and projection matrices
     */
    private updateMatrices(): void {
        mat4.lookAt(this.viewMatrix, this.position, this.target, this.up);
        mat4.perspective(this.projectionMatrix, this.fov, this.aspect, this.near, this.far);
    }
    
    /**
     * Handle mouse down event
     */
    handleMouseDown(event: MouseEvent, canvas: HTMLCanvasElement): void {
        this.lastMouseX = event.clientX;
        this.lastMouseY = event.clientY;
        
        if (event.button === 0) {
            // Left button - rotate
            this.isRotating = true;
        } else if (event.button === 2) {
            // Right button - pan
            this.isPanning = true;
        }
    }
    
    /**
     * Handle mouse move event
     */
    handleMouseMove(event: MouseEvent, canvas: HTMLCanvasElement): void {
        const deltaX = event.clientX - this.lastMouseX;
        const deltaY = event.clientY - this.lastMouseY;
        
        if (this.isRotating) {
            this.rotate(deltaX, deltaY, canvas);
        } else if (this.isPanning) {
            this.pan(deltaX, deltaY, canvas);
        }
        
        this.lastMouseX = event.clientX;
        this.lastMouseY = event.clientY;
    }
    
    /**
     * Handle mouse up event
     */
    handleMouseUp(event: MouseEvent): void {
        if (event.button === 0) {
            this.isRotating = false;
        } else if (event.button === 2) {
            this.isPanning = false;
        }
    }
    
    /**
     * Handle mouse wheel event
     */
    handleWheel(event: WheelEvent): void {
        event.preventDefault();
        
        const zoomAmount = event.deltaY * 0.001 * this.zoomSpeed;
        this.targetDistance *= Math.exp(zoomAmount);
        this.targetDistance = Math.max(this.minDistance, Math.min(this.maxDistance, this.targetDistance));
    }
    
    /**
     * Rotate camera
     */
    private rotate(deltaX: number, deltaY: number, canvas: HTMLCanvasElement): void {
        const rotX = (2 * Math.PI * this.rotateSpeed * deltaX) / canvas.clientHeight;
        const rotY = (2 * Math.PI * this.rotateSpeed * deltaY) / canvas.clientHeight;
        
        this.targetAzimuth -= rotX;
        this.targetElevation -= rotY;
        
        // Clamp elevation
        this.targetElevation = Math.max(
            this.minElevation,
            Math.min(this.maxElevation, this.targetElevation)
        );
    }
    
    /**
     * Pan camera
     */
    private pan(deltaX: number, deltaY: number, canvas: HTMLCanvasElement): void {
        const offset = vec3.create();
        vec3.subtract(offset, this.position, this.target);
        const targetDistance = vec3.length(offset);
        
        // Half of the FOV is center to top of screen
        const fovScale = Math.tan(this.fov / 2) * targetDistance;
        
        // Pan proportional to distance
        const panX = (2 * this.panSpeed * deltaX * fovScale) / canvas.clientHeight;
        const panY = (2 * this.panSpeed * deltaY * fovScale) / canvas.clientHeight;
        
        // Calculate pan vectors in camera space
        const right = vec3.create();
        const forward = vec3.create();
        
        vec3.subtract(forward, this.target, this.position);
        vec3.normalize(forward, forward);
        vec3.cross(right, forward, this.up);
        vec3.normalize(right, right);
        
        const actualUp = vec3.create();
        vec3.cross(actualUp, right, forward);
        vec3.normalize(actualUp, actualUp);
        
        // Apply pan to target
        vec3.scaleAndAdd(this.targetCenter, this.targetCenter, right, panX);
        vec3.scaleAndAdd(this.targetCenter, this.targetCenter, actualUp, -panY);
    }
    
    /**
     * Update camera state with damping
     */
    update(deltaTime: number = 1.0): void {
        if (this.enableDamping) {
            // Apply damping to all parameters
            const t = 1 - Math.exp(-this._dampingFactor * 10 * deltaTime);
            
            this.azimuth += (this.targetAzimuth - this.azimuth) * t;
            this.elevation += (this.targetElevation - this.elevation) * t;
            this.distance += (this.targetDistance - this.distance) * t;
            vec3.lerp(this.target, this.target, this.targetCenter, t);
        } else {
            this.azimuth = this.targetAzimuth;
            this.elevation = this.targetElevation;
            this.distance = this.targetDistance;
            vec3.copy(this.target, this.targetCenter);
        }
        
        this.updatePosition();
        this.updateMatrices();
    }
    
    /**
     * Set aspect ratio
     */
    setAspectRatio(aspect: number): void {
        this.aspect = aspect;
        this.updateMatrices();
    }
    
    /**
     * Reset camera to initial state
     */
    reset(position: vec3, target: vec3): void {
        vec3.copy(this.target, target);
        vec3.copy(this.targetCenter, target);
        
        const offset = vec3.create();
        vec3.subtract(offset, position, target);
        this.distance = vec3.length(offset);
        this.targetDistance = this.distance;
        
        this.azimuth = Math.atan2(offset[0], offset[2]);
        this.elevation = Math.acos(offset[1] / this.distance);
        this.targetAzimuth = this.azimuth;
        this.targetElevation = this.elevation;
        
        this.updatePosition();
        this.updateMatrices();
    }
}
