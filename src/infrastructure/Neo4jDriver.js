const neo4j = require('neo4j-driver');

class Neo4jDriver {
  constructor() {
    const uri = process.env.NEO4J_URI;
    if (!uri) {
      this.uri = '';
      this.database = undefined;
      this.auth = null;
      this.driver = null;
      this.didDirectFallback = false;
      console.warn('[Neo4j] NEO4J_URI is not configured; workflow storage is unavailable.');
      return;
    }

    this.uri = uri;
    console.log(`[Neo4j] Configured URI: ${this.safeUriForLogs(this.uri)}`);
    this.database = (process.env.NEO4J_DATABASE || '').trim() || undefined;
    console.log(`[Neo4j] Configured database: ${this.database || 'default'}`);
    this.auth = neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD);
    this.driver = this.createDriver(this.uri);
    this.didDirectFallback = false;
  }

  safeUriForLogs(uri) {
    try {
      const parsed = new URL(uri);
      return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`;
    } catch (error) {
      return `${uri || ''}`.replace(/\/\/.*@/, '//***@');
    }
  }

  createDriver(uri) {
    return neo4j.driver(uri, this.auth, this.buildDriverConfig(uri));
  }

  buildDriverConfig(uri) {
    const scheme = `${uri || ''}`.split(':')[0].toLowerCase();
    const isSecureScheme = scheme.endsWith('+s') || scheme.endsWith('+ssc');
    const isLocalDirectBolt = scheme === 'bolt' || scheme === 'bolt+ssc';

    if (isSecureScheme) {
      return {};
    }

    if (isLocalDirectBolt) {
      return { encrypted: false };
    }

    return {};
  }

  directUriFromRoutingUri(uri) {
    if (uri.startsWith('neo4j+s://')) {
      return uri.replace(/^neo4j\+s:\/\//, 'bolt+s://');
    }

    if (uri.startsWith('neo4j+ssc://')) {
      return uri.replace(/^neo4j\+ssc:\/\//, 'bolt+ssc://');
    }

    if (uri.startsWith('neo4j://')) {
      return uri.replace(/^neo4j:\/\//, 'bolt://');
    }

    return null;
  }

  isDiscoveryError(error) {
    const message = `${error?.message || ''}`;
    return message.includes('Could not perform discovery')
      || message.includes('No routing servers available')
      || message.includes('Unable to retrieve routing information')
      || message.includes('Failed to update routing table');
  }

  isConnectivityError(error) {
    const code = `${error?.code || ''}`;
    const message = `${error?.message || ''}`;
    return code === 'ServiceUnavailable'
      || message.includes('Failed to connect to server')
      || message.includes('No routing servers available')
      || message.includes('Unable to retrieve routing information')
      || message.includes('Could not perform discovery');
  }

  unavailableError(error) {
    const unavailable = new Error('Workflow storage is unavailable. Check Neo4j connectivity.');
    unavailable.code = 'WORKFLOW_STORAGE_UNAVAILABLE';
    unavailable.cause = error;
    return unavailable;
  }

  async switchToDirectFallback(error) {
    if (this.didDirectFallback || !this.isDiscoveryError(error)) {
      return false;
    }

    const directUri = this.directUriFromRoutingUri(this.uri);
    if (!directUri) {
      return false;
    }

    console.warn(`[Neo4j] Routing discovery failed; retrying with direct URI ${directUri}`);
    await this.driver.close().catch(() => {});
    this.uri = directUri;
    this.driver = this.createDriver(this.uri);
    this.didDirectFallback = true;
    return true;
  }

  async run(cypher, params = {}) {
    console.log(`[Neo4j] Executing: ${cypher}`);
    return this.runWithDriver(cypher, params, true);
  }

  async runWithDriver(cypher, params = {}, allowDirectFallback = true) {
    if (!this.driver) {
      throw this.unavailableError(new Error('NEO4J_URI is not configured'));
    }
    const session = this.driver.session(this.database ? { database: this.database } : undefined);
    try {
      const result = await session.run(cypher, params);
      console.log(`[Neo4j] Success: ${result.records.length} records`);
      return result.records.map(r => r.toObject());
    } catch (error) {
      console.error(`[Neo4j] ERROR: ${error.message}`);
      if (allowDirectFallback && await this.switchToDirectFallback(error)) {
        return this.runWithDriver(cypher, params, false);
      }
      if (this.isConnectivityError(error)) {
        throw this.unavailableError(error);
      }
      throw error;
    } finally {
      await session.close();
    }
  }

  async close() {
    if (this.driver) {
      await this.driver.close();
    }
  }

  async healthCheck(timeoutMs = 2000) {
    if (!this.driver) {
      return {
        status: 'not_configured',
        error: 'NEO4J_URI no esta configurado.'
      };
    }
    let timeoutId;
    try {
      await Promise.race([
        this.driver.verifyConnectivity(),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Neo4j connectivity check timed out')), timeoutMs);
        })
      ]);
      return { status: 'ok' };
    } catch (error) {
      return {
        status: 'unavailable',
        error: this.isConnectivityError(error) || /timed out/i.test(`${error?.message || ''}`)
          ? 'No se pudo conectar con Neo4j.'
          : 'Neo4j rechazó la comprobación de conectividad.'
      };
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }
}

module.exports = Neo4jDriver;
