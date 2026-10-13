import { Controller } from '../routing/Controller.js';
import { DeploymentRuntime } from './Runtime.js';

export class DeploymentController extends Controller {
  async ready(): Promise<Response> {
    const state = await DeploymentRuntime.readiness();
    return this.json({ data: state, meta: {} }, state.ready ? 200 : 503, { 'Cache-Control': 'no-store' });
  }
  async traffic(): Promise<Response> {
    const state = await DeploymentRuntime.traffic();
    return this.json({ data: state, meta: {} }, state.ready ? 200 : 503, { 'Cache-Control': 'no-store' });
  }
}
