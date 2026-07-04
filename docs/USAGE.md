# Guia de Uso - MCP Azure DevOps Automation

## Início Rápido

### 1. Configurar o ambiente

```bash
# Clonar
git clone https://github.com/sda-iatec/mcp-azure-devops-automation.git
cd mcp-azure-devops-automation

# Instalar e buildar
npm install
npm run build

# Configurar credenciais
cp .env.example .env
# Editar .env
```

### 2. Registrar no client MCP

Adicione ao seu `settings.json` do Kiro ou `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "azure-devops-automation": {
      "command": "node",
      "args": ["./dist/index.js"],
      "env": {
        "AZURE_DEVOPS_ORG_URL": "https://dev.azure.com/sda-iatec",
        "AZURE_DEVOPS_PAT": "xxx",
        "AZURE_DEVOPS_PROJECT": "MeuProjeto",
        "WORKSPACE_ROOT": "/home/dev/projetos/meu-projeto"
      }
    }
  }
}
```

### 3. Usar via conversa natural

```
Usuário: "Busque a feature 7890 no Azure DevOps"

Assistente: [usa tool buscar_feature com featureId=7890]
→ Retorna detalhes da feature, tasks, test cases...
```

---

## Cenários de Uso

### Cenário 1: Busca simples de Feature

```
"Busque a feature 12345"
```

O MCP chama `buscar_feature` e retorna:
- Título, descrição, critérios de aceite
- Lista de tasks com estados
- Test cases associados
- Tags e assignees

---

### Cenário 2: Análise completa antes de implementar

```
"Analise a feature 12345 e me diga o impacto no código"
```

O MCP chama `analisar_feature` que:
1. Busca a feature no Azure DevOps
2. Escaneia o workspace buscando projetos (.csproj, package.json)
3. Identifica arquivos relevantes baseado em palavras-chave
4. Calcula complexidade (low/medium/high)
5. Lista riscos e mitigações
6. Sugere plano de implementação

**Exemplo de resposta:**
```json
{
  "summary": "Feature 'Implementar notificações push' requer modificações em 3 áreas...",
  "estimatedComplexity": "medium",
  "impactedAreas": [
    { "project": "Api.Notifications", "files": ["..."], "changeType": "modify" }
  ],
  "suggestedApproach": [
    "1. Criar branch feature/12345-notificacoes-push",
    "2. Implementar task: Criar endpoint de registro de device",
    "..."
  ],
  "risks": [
    { "description": "Múltiplas áreas impactadas", "severity": "medium" }
  ]
}
```

---

### Cenário 3: Pipeline completo automatizado

```
"Execute o pipeline completo para a feature 12345"
```

Fluxo:
1. **Análise** → gera plano
2. **Pausa** → "Deseja aprovar a análise?" → Usuário: "Sim, aprovado"
3. **Tasks** → implementa cada task
4. **Build** → compila projetos
5. **Testes** → executa unit + integration + e2e
6. **Execução local** → valida com health check
7. **Pausa** → "Deseja criar o PR?" → Usuário: "Sim"
8. **Pull Request** → cria branch, commit, push, PR

---

### Cenário 4: Executar apenas testes

```
"Execute os testes unitários do projeto"
"Execute todos os testes"
"Rode os testes de integração"
```

---

### Cenário 5: Build isolado

```
"Faça o build do projeto em Release"
```

---

### Cenário 6: Acompanhar pipeline

```
"Qual o status do pipeline abc-123?"
"Existem aprovações pendentes?"
```

---

## Fluxo de Aprovação

Quando o pipeline solicita aprovação, ele **pausa** e aguarda:

```
Assistente: "A análise da Feature #12345 foi concluída:
  - 5 tasks identificadas
  - 3 projetos impactados
  - Complexidade: média
  
  Deseja aprovar e prosseguir com a implementação?
  (ID da aprovação: abc-123)"

Usuário: "Aprovado, pode continuar"

Assistente: [usa tool aprovar_etapa com approvalId="abc-123", approved=true]
→ Pipeline retoma execução
```

---

## Criando o PAT no Azure DevOps

1. Acesse: `https://dev.azure.com/sda-iatec/_usersSettings/tokens`
2. Clique em **"New Token"**
3. Configure:
   - **Name**: `mcp-automation`
   - **Expiration**: 90 dias (ou custom)
   - **Scopes**:
     - ✅ Work Items: Read & Write
     - ✅ Code: Read & Write  
     - ✅ Pull Request Threads: Read & Write
     - ✅ Build: Read
4. Copie o token gerado para o `.env`

---

## Troubleshooting

### Erro: "Feature não encontrada"
- Verifique se o ID está correto
- Confirme que o PAT tem acesso ao projeto

### Erro: "Variável de ambiente não definida"
- Verifique se o `.env` está configurado
- Ou passe via `env` na config do MCP client

### Build falha
- Verifique se .NET SDK/Node.js estão instalados
- Confirme que `WORKSPACE_ROOT` aponta para o diretório correto

### Testes falham com timeout
- Aumente `TEST_TIMEOUT_MS` no `.env`
- Para E2E, confirme que `E2E_BASE_URL` está acessível

### Pipeline parado
- Use `listar_aprovacoes` para ver aprovações pendentes
- Use `status_pipeline` para ver o estado atual
