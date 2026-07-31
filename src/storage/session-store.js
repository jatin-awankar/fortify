import path from "node:path";
import { ProjectContextService } from "../services/project-context-service.js";

export class SessionStore {
  constructor({
    projectContextService = new ProjectContextService()
  } = {}) {
    this.projectContextService = projectContextService;
  }

  async getProjectRules() {
    const config = await this.projectContextService.loadProjectConfig();
    return config?.instructions || "";
  }

  async setProjectRules(instructions) {
    const currentConfig = (await this.projectContextService.loadProjectConfig()) || {};
    const updatedConfig = {
      ...currentConfig,
      name: currentConfig.name || path.basename(this.projectContextService.cwd),
      stack: currentConfig.stack || (await this.projectContextService.detectStack()),
      instructions: typeof instructions === "string" ? instructions.trim() : "",
      updatedAt: new Date().toISOString()
    };

    await this.projectContextService.saveProjectConfig(updatedConfig);
    return updatedConfig;
  }
}
