/**
 * GPUContext - Handles WebGPU device initialization and context management
 */
export class GPUContext {
    public device!: GPUDevice;
    public context!: GPUCanvasContext;
    public format!: GPUTextureFormat;
    public canvas: HTMLCanvasElement;
    
    private adapter!: GPUAdapter;
    
    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
    }
    
    /**
     * Initialize WebGPU device and canvas context
     */
    async initialize(): Promise<boolean> {
        try {
            // Check for WebGPU support
            if (!navigator.gpu) {
                console.error('WebGPU is not supported in this browser');
                return false;
            }
            
            // Request adapter
            this.adapter = await navigator.gpu.requestAdapter({
                powerPreference: 'high-performance',
            });
            
            if (!this.adapter) {
                console.error('Failed to get GPU adapter');
                return false;
            }
            
            // Log adapter info (if available)
            try {
                if (typeof this.adapter.requestAdapterInfo === 'function') {
                    const info = await this.adapter.requestAdapterInfo();
                    console.log('GPU Adapter:', {
                        vendor: info.vendor,
                        architecture: info.architecture,
                        device: info.device,
                        description: info.description,
                    });
                } else {
                    console.log('GPU Adapter: requestAdapterInfo not available');
                }
            } catch (e) {
                console.warn('Could not retrieve adapter info:', e);
            }
            
            // Request device
            this.device = await this.adapter.requestDevice({
                requiredFeatures: [],
                requiredLimits: {
                    maxTextureDimension2D: 4096,
                    maxComputeWorkgroupSizeX: 256,
                    maxComputeWorkgroupSizeY: 256,
                },
            });
            
            // Handle device lost
            this.device.lost.then((info) => {
                console.error('WebGPU device was lost:', info.message);
                if (info.reason !== 'destroyed') {
                    // Device lost unexpectedly, could try to reinitialize
                    console.log('Attempting to reinitialize...');
                }
            });
            
            // Get canvas context
            const context = this.canvas.getContext('webgpu');
            if (!context) {
                console.error('Failed to get WebGPU context from canvas');
                return false;
            }
            this.context = context;
            
            // Configure context
            this.format = navigator.gpu.getPreferredCanvasFormat();
            this.context.configure({
                device: this.device,
                format: this.format,
                alphaMode: 'opaque',
            });
            
            console.log('WebGPU initialized successfully');
            console.log('Canvas format:', this.format);
            
            return true;
            
        } catch (error) {
            console.error('Failed to initialize WebGPU:', error);
            return false;
        }
    }
    
    /**
     * Resize canvas and reconfigure context
     */
    resize(width: number, height: number): void {
        this.canvas.width = width;
        this.canvas.height = height;
        
        // Context is automatically reconfigured when canvas size changes
    }
    
    /**
     * Get device limits
     */
    getLimits(): GPUSupportedLimits {
        return this.device.limits;
    }
    
    /**
     * Get device features
     */
    getFeatures(): GPUSupportedFeatures {
        return this.device.features;
    }
    
    /**
     * Create a texture with common parameters
     */
    createTexture(descriptor: {
        width: number;
        height: number;
        format?: GPUTextureFormat;
        usage?: GPUTextureUsageFlags;
        label?: string;
    }): GPUTexture {
        return this.device.createTexture({
            size: [descriptor.width, descriptor.height, 1],
            format: descriptor.format || 'rgba16float',
            usage: descriptor.usage || (
                GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.STORAGE_BINDING |
                GPUTextureUsage.COPY_DST
            ),
            label: descriptor.label,
        });
    }
    
    /**
     * Create a buffer with common parameters
     */
    createBuffer(descriptor: {
        size: number;
        usage: GPUBufferUsageFlags;
        label?: string;
        mappedAtCreation?: boolean;
    }): GPUBuffer {
        return this.device.createBuffer({
            size: descriptor.size,
            usage: descriptor.usage,
            label: descriptor.label,
            mappedAtCreation: descriptor.mappedAtCreation || false,
        });
    }
    
    /**
     * Cleanup resources
     */
    destroy(): void {
        this.device.destroy();
    }
}
