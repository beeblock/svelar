/**
 * Svelar Admin Dashboard Plugin
 *
 * Provides a centralized admin dashboard that aggregates system health,
 * queue metrics, scheduler status, and logs for monitoring and management.
 *
 * @example
 * ```ts
 * import { Dashboard, configureDashboard, getDashboardHealth } from 'svelar/dashboard';
 *
 * // Configure the dashboard
 * configureDashboard({
 *   enabled: true,
 *   prefix: '/admin/dashboard',
 *   refreshInterval: 5000,
 * });
 *
 * // Get system health
 * const health = getDashboardHealth();
 * console.log(`Uptime: ${health.uptime}ms`);
 *
 * // Get full dashboard data
 * const data = Dashboard.getDashboardData();
 * ```
 */

import type { Container } from '../container/Container.js';
import { Plugin } from '../plugins/index.js';
import { singleton } from '../support/singleton.js';
import { LogViewer } from '../logging/LogViewer.js';
import { JobMonitor, type QueueHealth } from '../queue/JobMonitor.js';
import { ScheduleMonitor, type SchedulerHealth } from '../scheduler/ScheduleMonitor.js';

// ── Types ──────────────────────────────────────────────────

export interface DashboardConfig {
  /** Enable or disable the dashboard */
  enabled?: boolean;
  /** Route prefix for dashboard endpoints (default: '/admin/dashboard') */
  prefix?: string;
  /** Interval in ms for automatic health collection (default: 5000) */
  refreshInterval?: number;
  /** Section visibility toggles */
  sections?: {
    logs?: boolean;
    queue?: boolean;
    scheduler?: boolean;
    system?: boolean;
  };
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'critical';
  uptime: number;
  nodeVersion: string;
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    external: number;
  };
  cpuUsage: {
    user: number;
    system: number;
  };
  queueHealth: QueueHealth;
  schedulerHealth: SchedulerHealth;
  logStats: {
    totalEntries: number;
    byLevel: Record<string, number>;
    byChannel: Record<string, number>;
  };
  timestamp: string;
}

// ── Dashboard Plugin ────────────────────────────────────

class DashboardPlugin extends Plugin {
  readonly name = 'svelar-dashboard';
  readonly version = '1.0.0';
  readonly description = 'Admin dashboard with system health monitoring';

  private dashboardConfig: Required<DashboardConfig> = {
    enabled: true,
    prefix: '/admin/dashboard',
    refreshInterval: 5000,
    sections: {
      logs: true,
      queue: true,
      scheduler: true,
      system: true,
    },
  };

  private startTime = Date.now();
  private healthCollectionInterval: NodeJS.Timeout | null = null;

  /**
   * Return plugin configuration
   */
  config() {
    return {
      key: 'dashboard',
      defaults: this.dashboardConfig,
    };
  }

  /**
   * Register services and configuration
   */
  async register(app: Container): Promise<void> {
    // Register default config
    app.instance('config.dashboard', this.dashboardConfig);

    // Ensure monitors are initialized
    app.instance('svelar.logViewer', LogViewer);
    app.instance('svelar.jobMonitor', JobMonitor);
    app.instance('svelar.scheduleMonitor', ScheduleMonitor);
  }

  /**
   * Bootstrap the dashboard plugin
   */
  async boot(app: Container): Promise<void> {
    // Start periodic health collection
    if (this.dashboardConfig.enabled && this.dashboardConfig.refreshInterval > 0) {
      this.healthCollectionInterval = setInterval(() => {
        this.getSystemHealth().catch((err) => {
          console.error('[Dashboard] Health collection error:', err);
        });
      }, this.dashboardConfig.refreshInterval);
    }
  }

  /**
   * Clean up on shutdown
   */
  async shutdown(): Promise<void> {
    if (this.healthCollectionInterval) {
      clearInterval(this.healthCollectionInterval);
      this.healthCollectionInterval = null;
    }
  }

  /**
   * Update dashboard configuration
   */
  setConfig(config: DashboardConfig): void {
    this.dashboardConfig = {
      ...this.dashboardConfig,
      ...config,
      sections: {
        ...this.dashboardConfig.sections,
        ...(config.sections ?? {}),
      },
    };

    // Restart health collection with new interval
    if (this.healthCollectionInterval) {
      clearInterval(this.healthCollectionInterval);
      this.healthCollectionInterval = null;
    }

    if (this.dashboardConfig.enabled && this.dashboardConfig.refreshInterval > 0) {
      this.healthCollectionInterval = setInterval(() => {
        this.getSystemHealth().catch((err) => {
          console.error('[Dashboard] Health collection error:', err);
        });
      }, this.dashboardConfig.refreshInterval);
    }
  }

  /**
   * Get aggregated system health from all monitors
   */
  async getSystemHealth(): Promise<SystemHealth> {
    const uptime = Date.now() - this.startTime;
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    const queueHealth = await JobMonitor.getHealth();
    const schedulerHealth = await ScheduleMonitor.getHealth();
    const logStats = LogViewer.getStats();

    // Determine overall health status
    let status: 'healthy' | 'degraded' | 'critical' = 'healthy';
    if (queueHealth.failureRate > 50 || schedulerHealth.lastErrors.length > 5) {
      status = 'critical';
    } else if (queueHealth.failureRate > 20 || schedulerHealth.lastErrors.length > 2) {
      status = 'degraded';
    }

    // Check memory pressure
    const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    if (heapUsedPercent > 90) {
      status = status === 'healthy' ? 'degraded' : status;
    }

    return {
      status,
      uptime,
      nodeVersion: process.version,
      memoryUsage: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        rss: memUsage.rss,
        external: memUsage.external,
      },
      cpuUsage: {
        user: cpuUsage.user,
        system: cpuUsage.system,
      },
      queueHealth,
      schedulerHealth,
      logStats,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get complete dashboard data with all sections
   */
  async getDashboardData(): Promise<Record<string, any>> {
    const health = await this.getSystemHealth();

    const data: Record<string, any> = {
      health,
      config: this.dashboardConfig,
    };

    // Add section data based on config
    if (this.dashboardConfig.sections.logs) {
      data.logs = {
        stats: LogViewer.getStats(),
        recentErrors: LogViewer.getRecentErrors(20),
      };
    }

    if (this.dashboardConfig.sections.queue) {
      data.queue = {
        health: health.queueHealth,
      };
    }

    if (this.dashboardConfig.sections.scheduler) {
      data.scheduler = {
        health: health.schedulerHealth,
        tasks: ScheduleMonitor.listTasks(),
      };
    }

    if (this.dashboardConfig.sections.system) {
      data.system = {
        uptime: health.uptime,
        nodeVersion: health.nodeVersion,
        memoryUsage: health.memoryUsage,
        cpuUsage: health.cpuUsage,
      };
    }

    return data;
  }
}

// ── Singleton Export ────────────────────────────────────

/**
 * Global Dashboard singleton
 */
export const Dashboard = singleton('svelar.dashboard', () => new DashboardPlugin());

/**
 * Configure the dashboard
 */
export function configureDashboard(config: DashboardConfig): void {
  Dashboard.setConfig(config);
}

/**
 * Quick access to system health
 */
export async function getDashboardHealth(): Promise<SystemHealth> {
  return Dashboard.getSystemHealth();
}

/**
 * Quick access to full dashboard data
 */
export async function getDashboardData(): Promise<Record<string, any>> {
  return Dashboard.getDashboardData();
}
