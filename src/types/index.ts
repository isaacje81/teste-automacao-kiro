/**
 * Tipos e interfaces do MCP Azure DevOps Automation
 */

// ============================================================
// Azure DevOps Work Items
// ============================================================

export interface AzureDevOpsConfig {
  orgUrl: string;
  pat: string;
  project: string;
}

export interface WorkItem {
  id: number;
  title: string;
  type: WorkItemType;
  state: string;
  description: string;
  acceptanceCriteria?: string;
  assignedTo?: string;
  areaPath?: string;
  iterationPath?: string;
  tags?: string[];
  relations?: WorkItemRelation[];
  fields: Record<string, unknown>;
}

export type WorkItemType = 'Feature' | 'Task' | 'Test Case' | 'Bug' | 'User Story';

export interface WorkItemRelation {
  type: 'child' | 'parent' | 'related' | 'tested-by' | 'tests';
  workItemId: number;
  title?: string;
  workItemType?: WorkItemType;
  state?: string;
}

export interface FeatureAnalysis {
  feature: WorkItem;
  tasks: WorkItem[];
  testCases: WorkItem[];
  testTasks: WorkItem[];
  codebaseContext: CodebaseContext;
  analysisResult: AnalysisResult;
}

// ============================================================
// Codebase & Analysis
// ============================================================

export interface CodebaseContext {
  solutionPath: string;
  projects: ProjectInfo[];
  relevantFiles: string[];
  dependencies: string[];
}

export interface ProjectInfo {
  name: string;
  path: string;
  type: 'web' | 'api' | 'library' | 'test' | 'console';
  framework?: string;
  references: string[];
}

export interface AnalysisResult {
  summary: string;
  impactedAreas: ImpactedArea[];
  suggestedApproach: string[];
  risks: Risk[];
  estimatedComplexity: 'low' | 'medium' | 'high';
  requiredChanges: RequiredChange[];
}

export interface ImpactedArea {
  project: string;
  files: string[];
  description: string;
  changeType: 'new' | 'modify' | 'delete';
}

export interface Risk {
  description: string;
  severity: 'low' | 'medium' | 'high';
  mitigation: string;
}

export interface RequiredChange {
  file: string;
  description: string;
  type: 'create' | 'modify' | 'delete';
  priority: number;
}

// ============================================================
// Agent Types
// ============================================================

export type AgentType =
  | 'git-setup'
  | 'analysis'
  | 'task-executor'
  | 'build'
  | 'test'
  | 'runner'
  | 'pull-request'
  | 'documentation';

export interface AgentConfig {
  type: AgentType;
  name: string;
  description: string;
  timeout: number;
  retryCount: number;
}

export interface AgentResult {
  agent: AgentType;
  success: boolean;
  message: string;
  data?: unknown;
  logs: string[];
  duration: number;
  errors?: AgentError[];
}

export interface AgentError {
  code: string;
  message: string;
  details?: string;
  recoverable: boolean;
}

// ============================================================
// Build & Test
// ============================================================

export interface BuildResult {
  success: boolean;
  project: string;
  output: string;
  errors: string[];
  warnings: string[];
  duration: number;
}

export interface TestResult {
  type: 'unit' | 'integration' | 'e2e';
  success: boolean;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  failures: TestFailure[];
  coverage?: TestCoverage;
}

export interface TestFailure {
  testName: string;
  className: string;
  message: string;
  stackTrace?: string;
}

export interface TestCoverage {
  linePercentage: number;
  branchPercentage: number;
  functionPercentage: number;
}

// ============================================================
// Pull Request
// ============================================================

export interface PullRequestConfig {
  sourceBranch: string;
  targetBranch: string;
  title: string;
  description: string;
  workItemIds: number[];
  reviewers?: string[];
  labels?: string[];
  isDraft: boolean;
}

export interface PullRequestResult {
  id: number;
  url: string;
  status: 'created' | 'active' | 'completed' | 'abandoned';
  title: string;
}

// ============================================================
// Documentation
// ============================================================

export interface DocumentationConfig {
  docsRepo: string;
  docsRepoUrl: string;
  docsBasePath: string;
  targetBranch: string;
}

export interface DocumentationResult {
  prUrl: string;
  prId: number;
  docsCreated: string[];
  status: 'created' | 'failed';
}

// ============================================================
// Workflow / Pipeline
// ============================================================

export interface WorkflowStep {
  id: string;
  name: string;
  agent: AgentType;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'awaiting-approval';
  result?: AgentResult;
  dependsOn?: string[];
}

export interface WorkflowPipeline {
  id: string;
  featureId: number;
  steps: WorkflowStep[];
  status: 'running' | 'completed' | 'failed' | 'paused';
  startedAt: Date;
  completedAt?: Date;
  approvals: ApprovalRequest[];
}

export interface ApprovalRequest {
  id: string;
  stepId: string;
  message: string;
  status: 'pending' | 'approved' | 'rejected';
  data?: unknown;
  requestedAt: Date;
  respondedAt?: Date;
}
