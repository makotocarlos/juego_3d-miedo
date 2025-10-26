// World.js (con spawn dinámico Y lógica de next level, SIN BlockPrefab)
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
import Prize from './Prize.js'
// --- BlockPrefab quitado ---

export default class World {
  constructor(experience, { debug = false } = {}) {
    this.experience = experience
    this.scene = this.experience?.scene
    // --- this.blockPrefab quitado ---
    this.resources = this.experience?.resources
    this.levelManager = new LevelManager(this.experience)
    this.finalPrizeActivated = false
    this.gameStarted = false
    this.enemies = []
    this.coins = []
    this.collectedCoins = 0 // contador de monedas recogidas en la sesión
    this.coinGoal = 10 // meta cambiada a 10
    this.debug = debug

    // flags para la lógica de moneda final
    this._finalCoinMade = false // true cuando hayamos transformado/creado la moneda finalPrize

    // Sonidos
    this.coinSound = new Sound('/sounds/coin.ogg.mp3')
    this.ambientSound = new Sound('/sounds/ambiente.mp3')
    this.winner = new Sound('/sounds/winner.mp3')
    this.portalSound = new Sound('/sounds/portal.mp3')
    this.loseSound = new Sound('/sounds/lose.ogg')
    this.allowPrizePickup = false
    setTimeout(() => { this.allowPrizePickup = true }, 2000)

    // lugares por defecto para premios finales (si no se definen desde loader/JSON)
    this.finalPrizeLocations = this.finalPrizeLocations || [
      { x: 0, y: 1, z: 0 }
    ]

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
      try { 
        // Cargamos el nivel 1 explícitamente
        await this.loadLevel(1); 
      }
      catch (err) { 
        if (this.debug) console.warn('World: Fallo al cargar nivel 1, intentando loadFromAPI() como fallback', err) 
        try { await this.loader.loadFromAPI() }
        catch (errApi) { if (this.debug) console.warn('World: ToyCarLoader.loadFromAPI fallo:', errApi) }
      }

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

    // Limpia enemigos anteriores (importante para nextLevel)
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

  activateFinalPrize() {
    if (this.finalPrizeActivated) return
    this.finalPrizeActivated = true
    if (this.debug) console.log('activateFinalPrize: activando premios finales')

    const prizeModel = (this.loader && this.loader.prizes && this.loader.prizes[0] && this.loader.prizes[0].model) || this.resources?.items?.coinModel

    if (!prizeModel) {
      if (this.debug) console.warn('activateFinalPrize: no hay modelo de premio disponible')
      return
    }

    this.finalPrizes = this.finalPrizes || []

    if (!this.finalPrizeLocations || !this.finalPrizeLocations.length) {
      this.finalPrizeLocations = [{ x: 0, y: 1.5, z: 0 }]
    }

    this.finalPrizeLocations.forEach(loc => {
      const pos = new THREE.Vector3(loc.x, loc.y, loc.z)
      const prize = new Prize({
        model: prizeModel,
        position: pos,
        scene: this.scene,
        role: 'finalPrize',
        sound: this.winner
      })
      if (prize.pivot) prize.pivot.visible = true
      this.finalPrizes.push(prize)

      try {
        new FinalPrizeParticles({ scene: this.scene, targetPosition: pos, sourcePosition: pos, experience: this.experience })
      } catch (e) {
        if (this.debug) console.warn('No se pudo crear FinalPrizeParticles', e)
      }

      const originalCollect = prize.collect && prize.collect.bind(prize)

      prize.collect = (...args) => {
        try {
          if (originalCollect) originalCollect(...args)
          else {
            if (typeof prize.onCollect === 'function') {
              try { prize.onCollect(prize) } catch (e) {}
            }
          }

          if (prize.role === "finalPrize") {
            if (this.levelManager && this.levelManager.currentLevel < this.levelManager.totalLevels) {
              try { this.levelManager.nextLevel() } catch (e) { if (this.debug) console.warn('levelManager.nextLevel fallo', e) }
              this.points = 0 
              if (this.robot) this.robot.points = 0
            } else {
              try {
                if (this.experience && this.experience.tracker) {
                  const elapsed = this.experience.tracker.stop()
                  this.experience.tracker.saveTime(elapsed)
                  this.experience.tracker.showEndGameModal(elapsed)
                } else if (this.debug) {
                  console.warn('activateFinalPrize: tracker no disponible')
                }
              } catch (e) {
                if (this.debug) console.warn('activateFinalPrize: tracker fallo', e)
              }

              try {
                this.experience.obstacleWavesDisabled = true
                clearTimeout(this.experience.obstacleWaveTimeout)
                if (this.experience.raycaster && typeof this.experience.raycaster.removeAllObstacles === 'function') {
                  this.experience.raycaster.removeAllObstacles()
                }
              } catch (e) {
                if (this.debug) console.warn('activateFinalPrize: error desactivando oleadas/raycaster', e)
              }

              if (window.userInteracted && this.winner) {
                try { this.winner.play() } catch (e) {}
              }
            }
          }
        } catch (e) {
          if (this.debug) console.warn('Error en prize.collect wrapper', e)
        }
      }
    })

    if (window.userInteracted && this.portalSound) this.portalSound.play()
  }

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
      const angleOffset = (i - (count - 1) / 2) * 0.2
      const x = playerPos.x + Math.cos(angle + angleOffset) * radius
      const z = playerPos.z + Math.sin(angle + angleOffset) * radius
      const y = (playerPos.y ?? 1.5) + 0.6

      let spawnPos = new THREE.Vector3(x, y, z)

      let roleForThisCoin = 'default'
      if (!this._finalCoinMade && (this.collectedCoins >= (this.coinGoal - 1))) {
        roleForThisCoin = 'finalPrize'
        this._finalCoinMade = true

        try {
          const robotGroup = this.robot?.group
          const rp = playerPos.clone()
          let forward = new THREE.Vector3(0, 0, -1)
          if (robotGroup) {
            forward.applyQuaternion(robotGroup.quaternion)
            forward.y = 0
            forward.normalize()
          } else {
            forward.set(0, 0, -1)
          }
          const finalDistance = 5
          spawnPos = rp.add(forward.multiplyScalar(finalDistance))
          spawnPos.y = (playerPos.y ?? 1.5) + 0.6
          if (this.debug) console.log('spawnCoin: creando MONEDA FINAL cerca del robot en', spawnPos)
        } catch (e) {
          if (this.debug) console.warn('Error posicionando moneda final', e)
        }
      }

      const coin = new Coin({
        scene: this.scene,
        model: coinResource,
        position: spawnPos,
        robotRef: this.robot,
        debug: this.debug,
        role: roleForThisCoin,
        onCollect: (c) => {
          if (window.userInteracted && this.coinSound) this.coinSound.play()
          try {
            this.collectedCoins = (this.collectedCoins || 0) + 1
            if (this.debug) console.log('Monedas recogidas:', this.collectedCoins, 'role:', c.role)
            const role = (c.role || '').toString().trim()

            if (role === 'finalPrize') {
              if (this.debug) console.log('Moneda finalPrize recogida -> otorgando super premio')

              if (window.userInteracted && this.winner) this.winner.play()
              const pos = c.position ? new THREE.Vector3(c.position.x, c.position.y, c.position.z) : spawnPos.clone()
              new FinalPrizeParticles({ scene: this.scene, targetPosition: pos, sourcePosition: pos, experience: this.experience })

              this.collectedCoins += 1
              this.finalPrizeCollected = true

              try {
                if (this.levelManager && this.levelManager.currentLevel < this.levelManager.totalLevels) {
                  try { this.levelManager.nextLevel() } catch (e) { if (this.debug) console.warn('levelManager.nextLevel fallo', e) }
                  this.points = 0
                  if (this.robot) this.robot.points = 0
                } else {
                  if (this.experience && this.experience.tracker) {
                    const elapsed = this.experience.tracker.stop()
                    this.experience.tracker.saveTime(elapsed)
                    this.experience.tracker.showEndGameModal(elapsed)
                  } else if (this.debug) {
                    console.warn('finalCoin: tracker no disponible')
                  }

                  try {
                    this.experience.obstacleWavesDisabled = true
                    clearTimeout(this.experience.obstacleWaveTimeout)
                    if (this.experience.raycaster && typeof this.experience.raycaster.removeAllObstacles === 'function') {
                      this.experience.raycaster.removeAllObstacles()
                    }
                  } catch (e) {
                    if (this.debug) console.warn('finalCoin: error desactivando oleadas/raycaster', e)
                  }

                  if (window.userInteracted && this.winner) {
                    try { this.winner.play() } catch (e) {}
                  }
                }
              } catch (e) {
                if (this.debug) console.warn('Error ejecutando lógica finalPrize desde moneda', e)
              }
            }

            if (this.levelManager && typeof this.levelManager.onCoinCollected === 'function') {
              this.levelManager.onCoinCollected(c)
            }

            if (!this._finalCoinMade && this.collectedCoins >= this.coinGoal) {
              if (this.debug) console.log('Fallback: alcanzada coinGoal sin moneda final marcada -> activateFinalPrize()')
              this.activateFinalPrize()
            }
          } catch (e) { if (this.debug) console.warn('onCollect error', e) }
        }
      })

      this.coins.push(coin)
      if (this.debug) console.log(`spawnCoin: moneda creada en ${spawnPos.x.toFixed(1)}, ${spawnPos.z.toFixed(1)}. Total monedas: ${this.coins.length} role=${roleForThisCoin}`)
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
    // --- this.blockPrefab.update() quitado ---

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

    // actualizar premios finales
    if (this.finalPrizes && this.finalPrizes.length) {
      this.finalPrizes.forEach(p => {
        try {
          p.update?.(deltaSeconds)
        } catch (e) {}
      })
    }

    this.loader?.prizes?.forEach(p => { try { p.update?.(deltaSeconds) } catch (e) {} })
    
    // --- Lógica de optimización de físicas (MANTENIDA) ---
    const playerPos = this.experience.renderer.instance.xr.isPresenting
        ? this.experience.camera.instance.position
        : this.robot?.body?.position
    
    if (playerPos) { // Evita errores si playerPos no está listo
        this.scene.traverse((obj) => {
            if (obj.userData?.levelObject && obj.userData.physicsBody) {
                const dist = obj.position.distanceTo(playerPos)
                const shouldEnable = dist < 40 && obj.visible

                const body = obj.userData.physicsBody
                if (shouldEnable && !body.enabled) {
                    body.enabled = true
                } else if (!shouldEnable && body.enabled) {
                    body.enabled = false
                }
            }
        })
    }
    // --- FIN Optimización ---

    // --- Rotación de discoRaysGroup quitada ---
  }

  clearCurrentScene() {
    // --- Lógica de File 1: Limpiar spawners dinámicos ---
    if (this.ghostSpawnInterval) { clearInterval(this.ghostSpawnInterval); this.ghostSpawnInterval = null }
    if (this.ghostSpeedInterval) { clearInterval(this.ghostSpeedInterval); this.ghostSpeedInterval = null }
    if (this.coinSpawnInterval) { clearInterval(this.coinSpawnInterval); this.coinSpawnInterval = null }

    this.enemies?.forEach(e => e?.destroy?.())
    this.enemies = []

    this.coins?.forEach(c => { try { c.destroy() } catch (e) {} })
    this.coins = []

    if (this.finalPrizes && this.finalPrizes.length) {
      this.finalPrizes.forEach(p => { try { p.collect?.(); if (p.pivot) this.scene.remove(p.pivot) } catch (e) {} })
      this.finalPrizes = []
    }

    this._finalCoinMade = false
    // --- Fin Lógica de File 1 ---


    // --- Lógica de File 2: Limpiar objetos de nivel (bloques, etc.) ---
    if (!this.experience || !this.scene || !this.experience.physics || !this.experience.physics.world) {
        console.warn('⚠️ No se puede limpiar (clearCurrentScene): sistema de físicas no disponible.');
        return;
    }

    let visualObjectsRemoved = 0;
    let physicsBodiesRemoved = 0;
    const childrenToRemove = [];

    this.scene.children.forEach((child) => {
        if (child.userData && child.userData.levelObject) {
            childrenToRemove.push(child);
        }
    });

    childrenToRemove.forEach((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
            if (Array.isArray(child.material)) {
                child.material.forEach(mat => mat.dispose());
            } else {
                child.material.dispose();
            }
        }
        this.scene.remove(child);
        if (child.userData.physicsBody) {
            this.experience.physics.world.removeBody(child.userData.physicsBody);
        }
        visualObjectsRemoved++;
    });

    let physicsBodiesRemaining = -1;
    if (this.experience.physics && this.experience.physics.world && Array.isArray(this.experience.physics.bodies)) {
        const survivingBodies = [];
        let bodiesBefore = this.experience.physics.bodies.length;

        this.experience.physics.bodies.forEach((body) => {
            if (body.userData && body.userData.levelObject) {
                this.experience.physics.world.removeBody(body);
                physicsBodiesRemoved++;
            } else {
                survivingBodies.push(body);
            }
        });
        this.experience.physics.bodies = survivingBodies;
        physicsBodiesRemaining = survivingBodies.length;
    } else {
        console.warn('⚠️ Physics system no disponible o sin cuerpos activos, omitiendo limpieza física.');
    }

    if (this.debug) {
        console.log(`🧹 Escena limpiada (level transition).`);
        console.log(`✅ Objetos 3D (levelObject) eliminados: ${visualObjectsRemoved}`);
        console.log(`✅ Cuerpos físicos (levelObject) eliminados: ${physicsBodiesRemoved}`);
        if (physicsBodiesRemaining !== -1) {
            console.log(`🎯 Cuerpos físicos actuales en Physics World: ${physicsBodiesRemaining}`);
        }
    }

    if (this.loader && this.loader.prizes && this.loader.prizes.length > 0) {
        this.loader.prizes.forEach(prize => {
            if (prize.pivot) this.scene.remove(prize.pivot);
            if (prize.model) {
                this.scene.remove(prize.model);
                if (prize.model.geometry) prize.model.geometry.dispose();
            }
        });
        this.loader.prizes = [];
        if (this.debug) console.log('🎯 Premios (loader.prizes) del nivel anterior eliminados.');
    }

    this.finalPrizeActivated = false;

    // --- Limpieza de discoRaysGroup quitada ---
  }

  async loadLevel(level) {
    try {
        const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
        const apiUrl = `${backendUrl}/api/blocks?level=${level}`;
        let data;

        try {
            const res = await fetch(apiUrl);
            if (!res.ok) throw new Error('Error desde API');
            const ct = res.headers.get('content-type') || '';
            if (!ct.includes('application/json')) {
                const preview = (await res.text()).slice(0, 120);
                throw new Error(`Respuesta no-JSON desde API (${apiUrl}): ${preview}`);
            }
            data = await res.json();
            if (this.debug) console.log(`📦 Datos del nivel ${level} cargados desde API`);
        } catch (error) {
            if (this.debug) console.warn(`⚠️ No se pudo conectar con el backend. Usando datos locales para nivel ${level}...`, error.message);
            const publicPath = (p) => {
                const base = import.meta.env.BASE_URL || '/';
                return `${base.replace(/\/$/, '')}/${p.replace(/^\//, '')}`;
            };
            const localUrl = publicPath('data/toy_car_blocks.json');
            const localRes = await fetch(localUrl);
            if (!localRes.ok) throw new Error(`No se pudo cargar ${localUrl} (HTTP ${localRes.status})`);
            
            const allBlocks = await localRes.json();
            const filteredBlocks = allBlocks.filter(b => b.level == level);
            
            data = {
                blocks: filteredBlocks,
                spawnPoint: { x: -17, y: 1.5, z: -67 }
            };
            if(this.debug) console.log(`📦 Datos locales cargados para nivel ${level}, ${filteredBlocks.length} bloques encontrados.`);
        }

        const spawnPoint = data.spawnPoint || { x: 5, y: 1.5, z: 5 };

        // --- RESET GAME STATE (tu lógica) ---
        this.points = 0; 
        this.collectedCoins = 0;
        if (this.robot) this.robot.points = 0;
        this.finalPrizeActivated = false;
        this._finalCoinMade = false;
        this.defeatTriggered = false;
        if (this.experience.menu?.setStatus) this.experience.menu.setStatus(`🎖️ Puntos: 0`);
        // --- FIN RESET ---

        // --- LOAD BLOCKS (lógica del profesor) ---
        if (data.blocks && data.blocks.length > 0) {
            const publicPath = (p) => {
                const base = import.meta.env.BASE_URL || '/';
                return `${base.replace(/\/$/, '')}/${p.replace(/^\//, '')}`;
            };
            const preciseUrl = publicPath('config/precisePhysicsModels.json');
            const preciseRes = await fetch(preciseUrl);
            const preciseModels = await preciseRes.json();
            // Esta función procesa los bloques y los añade a la escena/físicas
            this.loader._processBlocks(data.blocks, preciseModels);
        } else {
            if (this.debug) console.warn(`No se encontraron bloques (blocks) para el nivel ${level} en los datos cargados.`);
        }
        // --- FIN LOAD BLOCKS ---

        // --- RESET PLAYER ---
        this.resetRobotPosition(spawnPoint);
        if (this.debug) console.log(`✅ Nivel ${level} cargado con spawn en`, spawnPoint);

        // --- RESTART DYNAMIC SPAWNERS (tu lógica) ---
        const initialEnemies = 1;
        this.spawnEnemies(initialEnemies);

        if (this.ghostSpeedInterval) clearInterval(this.ghostSpeedInterval);
        this.ghostSpeedInterval = setInterval(() => {
            this.increaseGhostSpeed(1.3)
        }, 20000);

        if (this.coinSpawnInterval) clearInterval(this.coinSpawnInterval);
        this.coinSpawnInterval = setInterval(() => {
            this.spawnCoin(3)
        }, 10000);
        // --- FIN RESTART SPAWNERS ---

    } catch (error) {
        console.error('❌ Error cargando nivel:', error);
    }
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