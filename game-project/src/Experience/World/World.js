// World.js (con spawn de enemigos, fantasmas y monedas)
import * as THREE from 'three'
import Environment from './Environment.js'
import Fox from './Fox.js'
import Robot from './Robot.js'
import ToyCarLoader from '../../loaders/ToyCarLoader.js'
import Floor from './Floor.js'
import ThirdPersonCamera from './ThirdPersonCamera.js'
import Sound from './Sound.js'
import AmbientSound from './AmbientSound.js'
import MobileControls from '../../controls/MobileControls.js'
import LevelManager from './LevelManager.js'
import FinalPrizeParticles from '../Utils/FinalPrizeParticles.js'
import Enemy from './Enemy.js'
import Coin from './Coin.js'

export default class World {
    constructor(experience, { debug = false } = {}) {
        this.experience = experience
        this.scene = this.experience?.scene
        this.resources = this.experience?.resources
        this.levelManager = new LevelManager(this.experience)
        this.finalPrizeActivated = false
        this.gameStarted = false
        this.enemies = []
        this.coins = []
        this.collectedCoins = 0 // contador de monedas recogidas en la sesión
        this.coinGoal = 13 // cantidad requerida para pasar al siguiente nivel
        this.debug = debug

        // Sonidos
        this.coinSound = new Sound('/sounds/coin.ogg.mp3')
        this.ambientSound = new AmbientSound('/sounds/ambiente.mp3') 
        this.winner = new Sound('/sounds/winner.mp3')
        this.portalSound = new Sound('/sounds/portal.mp3')
        this.loseSound = new Sound('/sounds/lose.ogg')
        this.allowPrizePickup = false
        setTimeout(() => { this.allowPrizePickup = true }, 2000)

        this._initWhenResourcesReady()
    }

    _initWhenResourcesReady() {
        try {
            this.resources = this.experience?.resources
            if (this.resources && typeof this.resources.on === 'function') {
                this.resources.on('ready', () => this._onResourcesReady())
                if (this.resources.items && Object.keys(this.resources.items).length > 0) {
                    setTimeout(() => this._onResourcesReady(), 0)
                }
            } else {
                const start = performance.now()
                const poll = () => {
                    this.resources = this.experience?.resources
                    if (this.resources && typeof this.resources.on === 'function') {
                        this.resources.on('ready', () => this._onResourcesReady())
                        if (this.resources.items && Object.keys(this.resources.items).length > 0) {
                            setTimeout(() => this._onResourcesReady(), 0)
                        }
                        return
                    }
                    if (this.resources && this.resources.items && Object.keys(this.resources.items).length > 0) {
                        setTimeout(() => this._onResourcesReady(), 0)
                        return
                    }
                    if (performance.now() - start > 5000) {
                        console.warn('World: resources.on no encontrado, forzando inicialización en fallback')
                        setTimeout(() => this._onResourcesReady(), 0)
                        return
                    }
                    setTimeout(poll, 150)
                }
                poll()
            }
        } catch (err) {
            console.error('World._initWhenResourcesReady error:', err)
            setTimeout(() => this._onResourcesReady(), 0)
        }
    }

    async _onResourcesReady() {
        try {
            if (this.debug) console.log('World: resources ready -> initializing world content')

            this.floor = new Floor(this.experience)
            this.environment = new Environment(this.experience)
            this.loader = new ToyCarLoader(this.experience)
            try { await this.loader.loadFromAPI() } 
            catch (err) { if (this.debug) console.warn('World: ToyCarLoader.loadFromAPI fallo:', err) }

            this.fox = new Fox(this.experience)
            this.robot = new Robot(this.experience)

            // Cámara y controles
            this.experience.vr?.bindCharacter?.(this.robot)
            this.thirdPersonCamera = new ThirdPersonCamera(this.experience, this.robot.group)
            this.mobileControls = new MobileControls({
                onUp: (pressed) => { this.experience.keyboard.keys.up = pressed },
                onDown: (pressed) => { this.experience.keyboard.keys.down = pressed },
                onLeft: (pressed) => { this.experience.keyboard.keys.left = pressed },
                onRight: (pressed) => { this.experience.keyboard.keys.right = pressed }
            })

            if (!this.experience.physics || !this.experience.physics.world) {
                console.error('🚫 Sistema de físicas no está inicializado al cargar el mundo.')
            }

            // Spawn inicial de 3 enemigos
            const initialEnemies = 3
            this.spawnEnemies(initialEnemies)

            // Spawn incremental de fantasmas cada 10s
            this.ghostSpawnInterval = setInterval(() => {
                this.spawnGhost()
            }, 10000)

            // Aumentar velocidad de fantasmas cada 20s
            this.ghostSpeedInterval = setInterval(() => {
                this.increaseGhostSpeed(1.2)
            }, 20000)

            // Spawn de monedas cada 10s
            this.coinSpawnInterval = setInterval(() => {
                this.spawnCoin()
            }, 10000)

            // Boosts puntuales
            setTimeout(() => { this.increaseGhostSpeed(2); if (this.debug) console.log('Velocidad de fantasmas duplicada al segundo 50') }, 50000)
            setTimeout(() => { this.increaseGhostSpeed(2); if (this.debug) console.log('Velocidad de fantasmas duplicada al segundo 100') }, 100000)
            setTimeout(() => { this.increaseGhostSpeed(5); if (this.debug) console.log('Fantasmas muy rápidos al segundo 150') }, 150000)

            this._checkVRMode()
            this.experience.renderer.instance.xr.addEventListener('sessionstart', () => this._checkVRMode())
        } catch (err) {
            console.error('World._onResourcesReady error:', err)
        }
    }

    spawnEnemies(count = 3) {
        if (!this.robot?.body) { if (this.debug) console.warn('spawnEnemies: robot no listo'); return }
        const zombieResource = this.resources?.items?.zombieModel
        if (!zombieResource) { console.error('spawnEnemies: zombieModel no encontrado'); return }

        this.enemies?.forEach(e => e?.destroy?.())
        this.enemies = []

        const playerPos = this.robot.body.position
        const minRadius = 25
        const maxRadius = 40
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2
            const radius = minRadius + Math.random() * (maxRadius - minRadius)
            const x = playerPos.x + Math.cos(angle) * radius
            const z = playerPos.z + Math.sin(angle) * radius
            const y = playerPos.y ?? 1.5
            const spawnPos = new THREE.Vector3(x, y, z)

            const enemy = new Enemy({
                scene: this.scene,
                physicsWorld: this.experience.physics?.world,
                playerRef: this.robot,
                model: zombieResource,
                position: spawnPos,
                experience: this.experience,
                debug: this.debug
            })
            enemy.delayActivation = 1.0 + i * 0.5
            enemy.isGhost = false // zombies iniciales no son fantasmas
            this.enemies.push(enemy)
        }
        if (this.debug) console.log(`spawnEnemies: se crearon ${this.enemies.length} enemigos`)
    }

    spawnGhost() {
        const zombieResource = this.resources?.items?.zombieModel
        if (!zombieResource || !this.robot?.body) return

        const playerPos = this.robot.body.position
        const minRadius = 25
        const maxRadius = 40
        const angle = Math.random() * Math.PI * 2
        const radius = minRadius + Math.random() * (maxRadius - minRadius)
        const x = playerPos.x + Math.cos(angle) * radius
        const z = playerPos.z + Math.sin(angle) * radius
        const y = playerPos.y ?? 1.5
        const spawnPos = new THREE.Vector3(x, y, z)

        const enemy = new Enemy({
            scene: this.scene,
            physicsWorld: this.experience.physics?.world,
            playerRef: this.robot,
            model: zombieResource,
            position: spawnPos,
            experience: this.experience,
            debug: this.debug
        })
        enemy.delayActivation = 0.5
        enemy.isGhost = true
        this.enemies.push(enemy)
        if (this.debug) console.log(`spawnGhost: apareció un fantasma. Total enemigos: ${this.enemies.length}`)
    }

    // Nuevo: spawn de moneda (ahora genera varias monedas por llamada)
    spawnCoin(count = 3) {
        const coinResource = this.resources?.items?.coinModel
        if (!coinResource || !this.robot?.body) {
            if (this.debug) console.warn('spawnCoin: coinModel o robot no disponible')
            return
        }

        const playerPos = this.robot.body.position
        const minRadius = 30
        const maxRadius = 45

        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2
            const radius = minRadius + Math.random() * (maxRadius - minRadius)
            // pequeña variación adicional para separar las monedas
            const angleOffset = (i - (count-1)/2) * 0.2
            const x = playerPos.x + Math.cos(angle + angleOffset) * radius
            const z = playerPos.z + Math.sin(angle + angleOffset) * radius
            const y = (playerPos.y ?? 1.5) + 0.6 // un poco por encima del suelo

            const spawnPos = new THREE.Vector3(x, y, z)

            const coin = new Coin({
                scene: this.scene,
                model: coinResource,
                position: spawnPos,
                robotRef: this.robot,
                debug: this.debug,
                onCollect: (c) => {
                    if (window.userInteracted && this.coinSound) this.coinSound.play()
                    try {
                        // contador local
                        this.collectedCoins = (this.collectedCoins || 0) + 1
                        if (this.debug) console.log('Monedas recogidas:', this.collectedCoins)

                        if (this.levelManager && typeof this.levelManager.onCoinCollected === 'function') {
                            this.levelManager.onCoinCollected(c)
                        }

                        // comprobar si alcanzó la meta para pasar al siguiente nivel
                        if (this.collectedCoins >= this.coinGoal) {
                            if (this.debug) console.log('Objetivo alcanzado: pasando a nivel 2')
                            // intentar varias opciones según qué métodos exponga LevelManager/Experience
                            if (this.levelManager && typeof this.levelManager.goToLevel === 'function') {
                                this.levelManager.goToLevel(2)
                            } else if (this.levelManager && typeof this.levelManager.advanceLevel === 'function') {
                                this.levelManager.advanceLevel()
                            } else if (this.experience && typeof this.experience.loadLevel === 'function') {
                                this.experience.loadLevel(2)
                            } else if (this.experience && typeof this.experience.resetGameToFirstLevel === 'function') {
                                // fallback: reiniciar o cargar lo que tengas definido
                                this.experience.resetGameToFirstLevel()
                            }
                        }

                    } catch (e) { if (this.debug) console.warn('onCollect error', e) }
                }
            })

            this.coins.push(coin)
            if (this.debug) console.log(`spawnCoin: moneda creada en ${x.toFixed(1)}, ${z.toFixed(1)}. Total monedas: ${this.coins.length}`)
        }
    }

    increaseGhostSpeed(multiplier = 1.2) {
        this.enemies?.forEach(enemy => {
            if (enemy.isGhost) {
                enemy.speed = (enemy.speed || 1) * multiplier
                if (this.debug) console.log(`increaseGhostSpeed: nueva velocidad ${enemy.speed}`)
            }
        })
    }

    toggleAudio() { this.ambientSound.toggle() }

    update(delta) {
        const deltaSeconds = (typeof delta === 'number' && delta > 0 && delta < 0.1) ? delta : delta
        this.fox?.update?.(deltaSeconds)
        this.robot?.update?.()
        if (this.gameStarted) {
            this.enemies?.forEach(e => { try { e.update(deltaSeconds) } catch (err) {} })

            const distToClosest = this.enemies?.reduce((min, e) => {
                if (!e?.body?.position || !this.robot?.body?.position) return min
                const d = e.body.position.distanceTo(this.robot.body.position)
                return Math.min(min, d)
            }, Infinity) ?? Infinity

            if (distToClosest < 1.0 && !this.defeatTriggered) {
                this.defeatTriggered = true
                if (window.userInteracted && this.loseSound) this.loseSound.play()
                const firstEnemy = this.enemies?.[0]
                const enemyMesh = firstEnemy?.model || firstEnemy?.group
                if (enemyMesh) { enemyMesh.scale.set(1.3,1.3,1.3); setTimeout(() => enemyMesh.scale.set(1,1,1),500) }
                this.experience.modal.show({
                    icon: '💀',
                    message: '¡El enemigo te atrapó!\n¿Quieres intentarlo otra vez?',
                    buttons: [
                        { text: '🔁 Reintentar', onClick: () => this.experience.resetGameToFirstLevel() },
                        { text: '❌ Salir', onClick: () => this.experience.resetGame() }
                    ]
                })
                return
            }
        }

        if (this.thirdPersonCamera && this.experience.isThirdPerson && !this.experience.renderer.instance.xr.isPresenting) {
            this.thirdPersonCamera.update()
        }

        // actualizar monedas
        if (this.coins && this.coins.length) {
            for (let i = this.coins.length - 1; i >= 0; i--) {
                const c = this.coins[i]
                try {
                    c.update(deltaSeconds)
                    if (c.collected) {
                        try { c.destroy() } catch (e) {}
                        this.coins.splice(i, 1)
                    }
                } catch (e) { if (this.debug) console.warn('Error actualizando coin', e) }
            }
        }

        this.loader?.prizes?.forEach(p => { try { p.update?.(deltaSeconds) } catch (e) {} })
    }

    clearCurrentScene() {
        if (this.ghostSpawnInterval) { clearInterval(this.ghostSpawnInterval); this.ghostSpawnInterval = null }
        if (this.ghostSpeedInterval) { clearInterval(this.ghostSpeedInterval); this.ghostSpeedInterval = null }
        if (this.coinSpawnInterval) { clearInterval(this.coinSpawnInterval); this.coinSpawnInterval = null }

        this.enemies?.forEach(e => e?.destroy?.())
        this.enemies = []

        this.coins?.forEach(c => { try { c.destroy() } catch (e) {} })
        this.coins = []
    }

    resetRobotPosition(spawn = { x: -17, y: 1.5, z: -67 }) {
        if (!this.robot?.body || !this.robot?.group) return
        this.robot.body.position.set(spawn.x, spawn.y, spawn.z)
        this.robot.body.velocity.set(0,0,0)
        this.robot.body.angularVelocity.set(0,0,0)
        this.robot.body.quaternion.setFromEuler(0,0,0)
        this.robot.group.position.set(spawn.x, spawn.y, spawn.z)
        this.robot.group.rotation.set(0,0,0)
    }

    _checkVRMode() {
        const isVR = this.experience.renderer.instance.xr.isPresenting
        if (isVR) {
            if (this.robot?.group) this.robot.group.visible = false
            this.enemies?.forEach(e => { if (e) e.delayActivation = Math.max(e.delayActivation||0,3.0) })
            this.experience.camera.instance.position.set(5,1.6,5)
            this.experience.camera.instance.lookAt(new THREE.Vector3(5,1.6,4))
        } else {
            if (this.robot?.group) this.robot.group.visible = true
        }
    }
}
