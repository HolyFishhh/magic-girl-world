import {
  ARCHETYPE_GRAPH,
  ARCHETYPE_GRAPH_SPEC,
  createContentMechanicsFingerprint,
  extractContentMechanicFeatures,
  type EncounterLineageMemory,
} from '../game-core';

export const DESIGN_KNOWLEDGE_GRAPH_SPEC = 'mwg.st-knowledge-graph/v2' as const;

export type KnowledgeNodeKind = 'archetype' | 'mechanic' | 'constraint' | 'enemy-family' | 'enemy-action';
export type KnowledgeEdgeKind =
  | 'evolves-to'
  | 'requires'
  | 'supports'
  | 'pays-off'
  | 'expresses'
  | 'anti-synergy'
  | 'uses-action'
  | 'related-to';

export interface KnowledgeNode {
  id: string;
  kind: KnowledgeNodeKind;
  label: string;
  data: Record<string, unknown>;
}

export interface KnowledgeEdge {
  id: string;
  from: string;
  to: string;
  kind: KnowledgeEdgeKind;
  weight: number;
  data?: Record<string, unknown>;
}

export interface KnowledgeGraphSnapshot {
  spec: typeof DESIGN_KNOWLEDGE_GRAPH_SPEC;
  contentVersion: string;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

export interface KnowledgeGraphView {
  spec: typeof DESIGN_KNOWLEDGE_GRAPH_SPEC;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  evolutionPaths: Array<{
    from: string;
    to: string;
    fromLabel: string;
    toLabel: string;
    transitionCost: number;
    bridgeFeatures: string[];
  }>;
}

export type KnowledgeGraphStorage = 'memory' | 'indexeddb' | 'unavailable';

export interface KnowledgeGraphPersistence {
  readonly storage: Exclude<KnowledgeGraphStorage, 'unavailable'>;
  load(): Promise<KnowledgeGraphSnapshot | null>;
  save(snapshot: KnowledgeGraphSnapshot): Promise<void>;
}

function stableId(...parts: unknown[]): string {
  return parts
    .map(part => String(part ?? '').trim().toLowerCase().replace(/[^a-z0-9_\-一-鿿]+/gi, '_'))
    .join(':');
}

function mechanicNodeId(field: string, value: string): string {
  return `mechanic:${stableId(field)}:${stableId(value)}`;
}

function connectMechanic(
  nodes: Map<string, KnowledgeNode>,
  edges: Map<string, KnowledgeEdge>,
  sourceId: string,
  field: string,
  value: string,
  kind: Extract<KnowledgeEdgeKind, 'requires' | 'supports' | 'pays-off' | 'expresses'>,
  data?: Record<string, unknown>,
): void {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) return;
  const nodeId = mechanicNodeId(field, normalizedValue);
  if (!nodes.has(nodeId)) {
    nodes.set(nodeId, {
      id: nodeId,
      kind: 'mechanic',
      label: normalizedValue,
      data: { field, value: normalizedValue },
    });
  }
  const edgeId = stableId(sourceId, kind, nodeId);
  edges.set(edgeId, {
    id: edgeId,
    from: sourceId,
    to: nodeId,
    kind,
    weight: kind === 'requires' || kind === 'pays-off' ? 1 : 0.7,
    ...(data ? { data } : {}),
  });
}

function connectPredicate(
  nodes: Map<string, KnowledgeNode>,
  edges: Map<string, KnowledgeEdge>,
  sourceId: string,
  predicate: { field: string; values?: string[]; minimum?: number; weight?: number },
  kind: Extract<KnowledgeEdgeKind, 'requires' | 'supports' | 'pays-off'>,
): void {
  const values = Array.isArray(predicate.values) && predicate.values.length > 0
    ? predicate.values
    : [predicate.minimum ? `registered:${predicate.minimum}` : 'registered'];
  values.forEach(value => connectMechanic(nodes, edges, sourceId, predicate.field, value, kind, {
    ...(Number.isFinite(predicate.minimum) ? { minimum: Number(predicate.minimum) } : {}),
    ...(Number.isFinite(predicate.weight) ? { featureWeight: Number(predicate.weight) } : {}),
  }));
}

function baseGraph(): KnowledgeGraphSnapshot {
  const nodes = new Map<string, KnowledgeNode>();
  const edges = new Map<string, KnowledgeEdge>();
  for (const archetype of ARCHETYPE_GRAPH) {
    const nodeId = `archetype:${archetype.id}`;
    nodes.set(nodeId, {
      id: nodeId,
      kind: 'archetype',
      label: archetype.label,
      data: {
        description: archetype.description,
        requiredFeatures: archetype.requiredFeatures,
        optionalFeatures: archetype.optionalFeatures,
        payoffFeatures: archetype.payoffFeatures,
        genericRoles: archetype.genericRoles,
      },
    });
    archetype.requiredFeatures.forEach(predicate => connectPredicate(nodes, edges, nodeId, predicate, 'requires'));
    archetype.optionalFeatures.forEach(predicate => connectPredicate(nodes, edges, nodeId, predicate, 'supports'));
    archetype.payoffFeatures.forEach(predicate => connectPredicate(nodes, edges, nodeId, predicate, 'pays-off'));
    archetype.genericRoles.forEach(role => connectMechanic(nodes, edges, nodeId, 'roles', role, 'supports'));
    for (const neighbor of archetype.neighbors) {
      const targetId = `archetype:${neighbor.target}`;
      const id = stableId(nodeId, 'evolves-to', targetId);
      edges.set(id, {
        id,
        from: nodeId,
        to: targetId,
        kind: 'evolves-to',
        weight: Math.max(0.01, 1 - neighbor.transitionCost),
        data: {
          transitionCost: neighbor.transitionCost,
          bridgeFeatures: neighbor.bridgeFeatures,
        },
      });
    }
    for (const constraint of archetype.antiSynergies) {
      const constraintId = `constraint:${stableId(constraint)}`;
      nodes.set(constraintId, {
        id: constraintId,
        kind: 'constraint',
        label: constraint,
        data: {},
      });
      const id = stableId(nodeId, 'anti-synergy', constraintId);
      edges.set(id, {
        id,
        from: nodeId,
        to: constraintId,
        kind: 'anti-synergy',
        weight: 1,
      });
    }
  }
  return {
    spec: DESIGN_KNOWLEDGE_GRAPH_SPEC,
    contentVersion: `${ARCHETYPE_GRAPH_SPEC}:${createContentMechanicsFingerprint(ARCHETYPE_GRAPH)}`,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
  };
}

function lineageGraph(lineage: EncounterLineageMemory): Pick<KnowledgeGraphSnapshot, 'nodes' | 'edges'> {
  const nodes = new Map<string, KnowledgeNode>();
  const edges = new Map<string, KnowledgeEdge>();
  for (const family of lineage.families) {
    const familyId = `family:${family.key}`;
    nodes.set(familyId, {
      id: familyId,
      kind: 'enemy-family',
      label: family.label || family.key,
      data: {
        encounters: family.encounters,
        members: family.memberNames,
        stages: family.stages,
        themeAxes: family.themeAxes,
        statusIds: family.statusIds,
      },
    });
    family.themeAxes.forEach(axis => connectMechanic(nodes, edges, familyId, 'axes', axis, 'expresses'));
    family.statusIds.forEach(status => connectMechanic(nodes, edges, familyId, 'statuses', status, 'expresses'));
    for (const action of family.canonicalActions) {
      const actionId = `enemy-action:${family.key}:${stableId(action.id, action.structuralFingerprint)}`;
      nodes.set(actionId, {
        id: actionId,
        kind: 'enemy-action',
        label: action.name,
        data: {
          structuralFingerprint: action.structuralFingerprint,
          definition: action.definition,
        },
      });
      const id = stableId(familyId, 'uses-action', actionId);
      edges.set(id, { id, from: familyId, to: actionId, kind: 'uses-action', weight: 1 });
      const features = extractContentMechanicFeatures(action.definition);
      for (const field of ['operations', 'axes', 'targets', 'zones', 'triggers', 'resources', 'statuses', 'roles'] as const) {
        features[field].forEach(value => connectMechanic(nodes, edges, actionId, field, value, 'expresses'));
      }
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

function cloneSnapshot(snapshot: KnowledgeGraphSnapshot): KnowledgeGraphSnapshot {
  return structuredClone(snapshot);
}

function graphFingerprint(snapshot: KnowledgeGraphSnapshot): string {
  return createContentMechanicsFingerprint({
    nodes: snapshot.nodes,
    edges: snapshot.edges,
  });
}

function isCompatibleSnapshot(value: unknown, expected: KnowledgeGraphSnapshot): value is KnowledgeGraphSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const snapshot = value as Partial<KnowledgeGraphSnapshot>;
  if (snapshot.spec !== DESIGN_KNOWLEDGE_GRAPH_SPEC || snapshot.contentVersion !== expected.contentVersion) return false;
  if (!Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.edges)) return false;
  const nodeIds = new Set<string>();
  for (const node of snapshot.nodes) {
    if (!node || typeof node !== 'object' || typeof node.id !== 'string' || !node.id) return false;
    if (!['archetype', 'mechanic', 'constraint', 'enemy-family', 'enemy-action'].includes(String(node.kind))) return false;
    if (nodeIds.has(node.id)) return false;
    nodeIds.add(node.id);
  }
  const edgeIds = new Set<string>();
  for (const edge of snapshot.edges) {
    if (!edge || typeof edge !== 'object' || typeof edge.id !== 'string' || !edge.id) return false;
    if (![
      'evolves-to', 'requires', 'supports', 'pays-off', 'expresses',
      'anti-synergy', 'uses-action', 'related-to',
    ].includes(String(edge.kind))) return false;
    if (!nodeIds.has(String(edge.from)) || !nodeIds.has(String(edge.to))) return false;
    if (!Number.isFinite(Number(edge.weight)) || edgeIds.has(edge.id)) return false;
    edgeIds.add(edge.id);
  }
  return graphFingerprint(snapshot as KnowledgeGraphSnapshot) === graphFingerprint(expected);
}

class IndexedGraphPersistence implements KnowledgeGraphPersistence {
  readonly storage = typeof indexedDB === 'undefined' ? 'memory' : 'indexeddb';
  private databasePromise: Promise<IDBDatabase> | null = null;

  private database(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('magic-girl-world-design-graph-v2', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('snapshots')) {
          request.result.createObjectStore('snapshots');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('无法打开流派图谱数据库'));
    });
    return this.databasePromise;
  }

  async load(): Promise<KnowledgeGraphSnapshot | null> {
    if (typeof indexedDB === 'undefined') return null;
    const database = await this.database();
    return new Promise<KnowledgeGraphSnapshot | null>((resolve, reject) => {
      const transaction = database.transaction('snapshots', 'readonly');
      const request = transaction.objectStore('snapshots').get('base');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('无法读取流派图谱'));
    });
  }

  async save(snapshot: KnowledgeGraphSnapshot): Promise<void> {
    if (typeof indexedDB === 'undefined') return;
    const database = await this.database();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('snapshots', 'readwrite');
      transaction.objectStore('snapshots').put(snapshot, 'base');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('无法保存流派图谱'));
    });
  }
}

/**
 * Versioned, queryable graph used by the extension. Matching remains structural:
 * narrative names are stored only for enemy-family continuity, never for archetype scoring.
 */
export class DesignKnowledgeGraph {
  private base = baseGraph();
  private storage: KnowledgeGraphStorage = 'memory';

  constructor(private readonly persistence: KnowledgeGraphPersistence = new IndexedGraphPersistence()) {}

  async initialize(): Promise<void> {
    if (this.persistence.storage === 'memory') return;
    try {
      const persisted = await this.persistence.load();
      if (isCompatibleSnapshot(persisted, this.base)) {
        this.base = cloneSnapshot(persisted);
      } else {
        await this.persistence.save(cloneSnapshot(this.base));
      }
      this.storage = 'indexeddb';
    } catch {
      // IndexedDB can be blocked by private browsing or WebView policies. The
      // bundled graph remains the authority and must keep gameplay available.
      this.storage = 'unavailable';
    }
  }

  stats(lineage?: EncounterLineageMemory): {
    nodes: number;
    edges: number;
    version: string;
    storage: KnowledgeGraphStorage;
  } {
    const dynamic = lineage ? lineageGraph(lineage) : { nodes: [], edges: [] };
    return {
      nodes: this.base.nodes.length + dynamic.nodes.length,
      edges: this.base.edges.length + dynamic.edges.length,
      version: this.base.contentVersion,
      storage: this.storage,
    };
  }

  query(archetypeIds: string[] = [], lineage?: EncounterLineageMemory, depth = 1, limit = 36): KnowledgeGraphView {
    const dynamic = lineage ? lineageGraph(lineage) : { nodes: [], edges: [] };
    const allNodes = [...new Map([...this.base.nodes, ...dynamic.nodes].map(node => [node.id, node])).values()];
    const allEdges = [...this.base.edges, ...dynamic.edges];
    const byId = new Map(allNodes.map(node => [node.id, node]));
    const requested = archetypeIds
      .map(id => id.startsWith('archetype:') ? id : `archetype:${id}`)
      .filter(id => byId.has(id));
    const seeds = requested.length
      ? requested
      : this.base.nodes.filter(node => node.kind === 'archetype').slice(0, 4).map(node => node.id);
    const visited = new Set(seeds);
    const frontier = [...seeds];
    for (let level = 0; level < Math.max(0, Math.min(3, depth)); level += 1) {
      const round = frontier.splice(0);
      for (const current of round) {
        for (const edge of allEdges) {
          if (edge.from !== current && edge.to !== current) continue;
          const target = edge.from === current ? edge.to : edge.from;
          if (visited.has(target) || visited.size >= limit) continue;
          visited.add(target);
          frontier.push(target);
        }
      }
    }
    for (const node of dynamic.nodes) {
      if (visited.size >= limit) break;
      visited.add(node.id);
    }
    const nodes = [...visited].map(id => byId.get(id)).filter((node): node is KnowledgeNode => Boolean(node));
    const edges = allEdges.filter(edge => visited.has(edge.from) && visited.has(edge.to));
    const evolutionPaths = edges
      .filter(edge => edge.kind === 'evolves-to')
      .slice(0, 12)
      .map(edge => ({
        from: edge.from,
        to: edge.to,
        fromLabel: byId.get(edge.from)?.label || edge.from,
        toLabel: byId.get(edge.to)?.label || edge.to,
        transitionCost: Number(edge.data?.transitionCost ?? Math.max(0, 1 - edge.weight)),
        bridgeFeatures: Array.isArray(edge.data?.bridgeFeatures)
          ? edge.data!.bridgeFeatures.map(String).slice(0, 6)
          : [],
      }));
    return { spec: DESIGN_KNOWLEDGE_GRAPH_SPEC, nodes, edges, evolutionPaths };
  }
}
