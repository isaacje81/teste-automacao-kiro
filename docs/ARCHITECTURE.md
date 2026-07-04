# Arquitetura do MCP Azure DevOps Automation

## Visão Geral da Arquitetura

O sistema segue uma arquitetura baseada em **agentes autônomos coordenados por um orquestrador (pipeline)**, exposta através do **Model Context Protocol (MCP)**.

## Camadas do Sistema

### 1. Camada de Transporte (MCP)

```
┌────────────────────────────────────────────┐
│            Transporte: stdio               │
│     (JSON-RPC 2.0 sobre stdin/stdout)      │
└────────────────────────────────────────────┘
```

O MCP Server se comunica via **stdio** usando o protocolo JSON-RPC 2.0. Isso permite integração nativa com qualquer client MCP (Kiro, Claude Desktop, Cursor, etc.).

### 2. Camada de Ferramentas (Tools)

As ferramentas são a interface pública do servidor. Cada tool:
- Tem um schema Zod para validação de entrada
- Retorna conteúdo formatado para o LLM
- Trata erros graciosamente

**Ferramentas disponíveis:** 9 tools (ver README.md)

### 3. Camada de Orquestração (Workflow)

O `WorkflowPipelineManager` coordena a execução dos agentes:

```
PipelineManager
├── EventEmitter (notifica progresso)
├── Approval System (pausa/retoma pipeline)
├── Step Execution (sequencial com dependências)
└── Error Recovery (falha graceful)
```

**Padrão de design:** Supervisor-Worker com checkpoints de aprovação humana.

### 4. Camada de Agentes

Cada agente herda de `BaseAgent` e implementa:

```typescript
abstract class BaseAgent {
  // Ciclo de vida
  execute(input) → AgentResult       // Entry point público
  run(input)     → {message, data}   // Lógica específica (abstrato)
  
  // Infraestrutura
  log(message)       // Logging estruturado
  checkTimeout()     // Verificação de timeout
  withTimeout(p, ms) // Wrapper de timeout
}
```

**Características dos agentes:**
- ✅ Retry automático com backoff exponencial
- ✅ Timeout configurável
- ✅ Logging estruturado
- ✅ Normalização de erros
- ✅ Execução isolada

### 5. Camada de Serviços

`AzureDevOpsService` encapsula toda comunicação com a API REST do Azure DevOps:
- Busca de Work Items (Features, Tasks, Test Cases)
- Navegação de relações (parent/child)
- Atualização de estado
- Adição de comentários
- Queries WIQL

## Fluxo de Dados

```
Input (featureId)
     │
     ▼
┌─────────────────┐
│ AzureDevOps API │──── Busca Feature + Children
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  AnalysisAgent  │──── Mapeia codebase, identifica impactos
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   APROVAÇÃO 1   │──── Humano valida plano
└────────┬────────┘
         │ (approved)
         ▼
┌─────────────────┐
│TaskExecutorAgent│──── Executa cada task sequencialmente
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   BuildAgent    │──── Compila todos os projetos
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│    TestAgent    │──── Unit → Integration → E2E
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   RunnerAgent   │──── Executa localmente + health check
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   APROVAÇÃO 2   │──── Humano valida antes do PR
└────────┬────────┘
         │ (approved)
         ▼
┌─────────────────┐
│PullRequestAgent │──── Branch + Commit + Push + PR
└────────┬────────┘
         │
         ▼
    Output (PR URL)
```

## Padrões de Design Utilizados

| Padrão | Onde | Motivo |
|--------|------|--------|
| **Strategy** | Agentes | Cada agente tem sua estratégia de execução |
| **Template Method** | BaseAgent | Ciclo de vida comum com customização |
| **Observer** | PipelineManager | Eventos de progresso assíncronos |
| **Chain of Responsibility** | Pipeline Steps | Etapas sequenciais com dependências |
| **Factory** | createSteps() | Criação padronizada de steps |
| **Adapter** | AzureDevOpsService | Interface uniforme para API externa |

## Decisões Arquiteturais

### Por que MCP?

- Protocolo aberto e padronizado
- Integra com qualquer LLM client compatível
- Separação clara entre AI e ferramentas
- Schema validation nativo (Zod)

### Por que agentes separados?

- **Responsabilidade única**: cada agente faz uma coisa bem
- **Testabilidade**: agentes testáveis isoladamente
- **Retry independente**: falha em um não afeta outros
- **Escalabilidade**: novos agentes facilmente adicionados

### Por que aprovação humana?

- **Segurança**: mudanças críticas validadas antes de aplicar
- **Compliance**: audit trail de quem aprovou
- **Confiança**: gradual trust building com automação

## Extensibilidade

Para adicionar um novo agente:

```typescript
// 1. Criar o agente
export class MeuNovoAgent extends BaseAgent {
  constructor() {
    super({ type: 'meu-tipo', name: 'Meu Agente', ... });
  }
  
  protected async run(input: unknown) {
    // Lógica aqui
    return { message: 'OK', data: {} };
  }
}

// 2. Registrar no pipeline (workflow/pipeline.ts)
// 3. Adicionar tool (tools/index.ts)
// 4. Exportar (agents/index.ts)
```
