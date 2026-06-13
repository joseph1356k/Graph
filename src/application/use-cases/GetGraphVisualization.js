class GetGraphVisualization {
  constructor(repository) {
    this.repository = repository;
  }

  async execute(access = null) {
    const { rawNodes, rawEdges } = await this.repository.getGraphVisualization(access);
    
    const toInt = (v) => v && typeof v.toNumber === 'function' ? v.toNumber() : v;
    const nodes = rawNodes.map((n) => ({ type: n.type, props: n.props, id: toInt(n.id) }));
    const edges = rawEdges.map((e) => ({ from: toInt(e.from), to: toInt(e.to), label: e.label }));

    return { nodes, edges };
  }
}

module.exports = GetGraphVisualization;
