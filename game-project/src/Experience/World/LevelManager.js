export default class LevelManager {
    constructor(experience) {
        this.experience = experience;
        this.currentLevel = 1;  // Inicias en el nivel 1
        this.totalLevels = 2;   // Total de niveles 
    }

    nextLevel() {
        if (this.currentLevel < this.totalLevels) {
            this.currentLevel++;
    
            this.experience.world.clearCurrentScene();
            this.experience.world.loadLevel(this.currentLevel);
    
            // Espera breve para que el nivel se cargue y luego reubicar al robot
            setTimeout(() => {
                this.experience.world.resetRobotPosition({ x: 0, y: 0, z: 0 }) //  Ajusta esta coordenada según el mundo nuevo
            }, 1000)
        }
    }
    

    resetLevel() {
        this.currentLevel = 1;
        this.experience.world.loadLevel(this.currentLevel);
    }


    getCurrentLevelTargetPoints() {
        return this.pointsToComplete?.[this.currentLevel] || 2;
    }
    
}
