#!/usr/bin/env node
/**
 * MCP Server - Azure DevOps Automation
 * 
 * Servidor MCP para automação de features do Azure DevOps
 * com agentes autônomos para análise, implementação, build,
 * testes e criação de Pull Requests.
 * 
 * Organização: sda-iatec
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config/index.js';
import { AzureDevOpsService } from './services/azure-devops.service.js';
import { WorkflowPipelineManager } from './workflow/pipeline.js';
import { registerTools } from './tools/index.js';

async function main() {
  // Carregar configuração
  const config = loadConfig();

  // Criar instâncias dos serviços
  const azureService = new AzureDevOpsService(config.azureDevOps);
  const pipelineManager = new WorkflowPipelineManager(azureService, config);

  // Criar MCP Server
  const server = new McpServer({
    name: 'mcp-azure-devops-automation',
    version: '1.0.0',
    capabilities: {
      tools: {},
    },
  });

  // Registrar ferramentas MCP
  registerTools(server, azureService, pipelineManager, config);

  // Listeners de eventos do pipeline
  pipelineManager.on('pipeline:started', (pipeline) => {
    console.error(`[Pipeline] Iniciado: ${pipeline.id} (Feature #${pipeline.featureId})`);
  });

  pipelineManager.on('step:started', (pipeline, step) => {
    console.error(`[Pipeline ${pipeline.id}] Step iniciado: ${step.name}`);
  });

  pipelineManager.on('step:completed', (pipeline, step) => {
    console.error(`[Pipeline ${pipeline.id}] Step concluído: ${step.name}`);
  });

  pipelineManager.on('step:failed', (pipeline, step) => {
    console.error(`[Pipeline ${pipeline.id}] Step falhou: ${step.name}`);
  });

  pipelineManager.on('approval:requested', (pipeline, approval) => {
    console.error(`[Pipeline ${pipeline.id}] ⚠️ Aprovação solicitada: ${approval.message}`);
    console.error(`  → ID: ${approval.id}`);
  });

  pipelineManager.on('pipeline:completed', (pipeline) => {
    console.error(`[Pipeline ${pipeline.id}] ✅ Pipeline concluído com sucesso!`);
  });

  pipelineManager.on('pipeline:failed', (pipeline) => {
    console.error(`[Pipeline ${pipeline.id}] ❌ Pipeline falhou`);
  });

  // Conectar ao transport stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('🚀 MCP Azure DevOps Automation Server iniciado');
  console.error(`📡 Conectado à organização: ${config.azureDevOps.orgUrl}`);
  console.error(`📁 Projeto: ${config.azureDevOps.project}`);
}

main().catch((error) => {
  console.error('Erro fatal ao iniciar o MCP Server:', error);
  process.exit(1);
});
