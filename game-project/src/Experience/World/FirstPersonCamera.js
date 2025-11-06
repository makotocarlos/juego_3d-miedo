import * as THREE from 'three'

export default class FirstPersonCamera {
    constructor(experience, targetObject) {
        this.experience = experience
        this.scene = experience.scene
        this.camera = experience.camera.instance
        this.target = targetObject // normalmente: robot.group
        this.offset = new THREE.Vector3(0, 6.5, 0) // altura de los ojos
    }

    update() {
        if (!this.target) return

        // Posición real del robot
        const basePosition = this.target.position.clone()

        // Punto de cámara (ligeramente adelantado)
        const direction = new THREE.Vector3(0, 0, -3)
        direction.applyEuler(this.target.rotation).normalize()

        const cameraPosition = basePosition
            .clone()
            .add(this.offset)
            .add(direction.clone().multiplyScalar(0.2)) // un poco hacia adelante

    // Posicionar la cámara
    // Si estamos en el nivel 1, hacer el seguimiento más lento (menor lerp) para "reducir la velocidad de la cámara".
    const currentLevel = this.experience.world?.levelManager?.currentLevel || 0
    const lerpSpeed = (currentLevel === 1) ? 0.12 : 0.3
    this.camera.position.lerp(cameraPosition, lerpSpeed)

        // Mirar hacia adelante en la misma dirección que el robot
        const lookAt = basePosition.clone().add(direction)
        this.camera.lookAt(lookAt)
    }
}
