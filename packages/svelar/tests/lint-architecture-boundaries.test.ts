import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LintArchitectureCommand } from '../src/cli/commands/LintArchitectureCommand.js';

let root:string;
const write=(path:string,source:string)=>{const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,source);};
const lint=()=>new LintArchitectureCommand().scanProject(join(root,'src'));
const workflow=()=>lint().filter(item=>['write-flow','controller-flow'].includes(item.rule));
beforeEach(()=>{root=mkdtempSync(join(process.cwd(),'.test-lint-boundary-'));mkdirSync(join(root,'src'));});
afterEach(()=>rmSync(root,{recursive:true,force:true}));

function publicLibrary() {
  write('node_modules/@beeblock/svelar/package.json',JSON.stringify({name:'@beeblock/svelar',type:'module',exports:{'./console':{types:'./dist/console/index.d.ts',import:'./dist/console/index.js'}}}));
  write('node_modules/@beeblock/svelar/dist/routing.d.ts','export declare class Controller {handle(method:string): (event:unknown)=>Promise<Response>;}');
  write('node_modules/@beeblock/svelar/dist/console/Operator.d.ts',"import {Controller as Base} from '../routing.js'; export declare class Operator extends Base {save(event:unknown):Promise<Response>;}");
  write('node_modules/@beeblock/svelar/dist/console/index.d.ts',"export {Operator as PublicConsole} from './Operator.js'; export declare class FakeController {handle(method:string):unknown;}");
  // Declaration evidence is read; executable packages/bootstrap must never be imported.
  write('node_modules/@beeblock/svelar/dist/console/index.js',"throw new Error('Library must not be executed by lint');");
}

describe('architecture workflow boundaries and DTO contracts',()=>{
  it.each(['alias','namespace','app-barrel'] as const)('recognizes public framework controller inheritance through %s without executing it',kind=>{
    publicLibrary();
    const imports=kind==='namespace'?"import * as core from '@beeblock/svelar/console'; const controller=new core.PublicConsole();"
      :kind==='app-barrel'?"import {AppConsole as Console} from '$lib/console.js'; const controller=new Console();"
      :"import {PublicConsole as Console} from '@beeblock/svelar/console'; const controller=new Console();";
    write('src/lib/console.ts',"export {PublicConsole as AppConsole} from '@beeblock/svelar/console';");
    write('src/routes/api/console/+server.ts',imports+"export const POST=controller.handle('save');");
    expect(lint()).toEqual([]);
  });
  it('does not trust an exported name ending Controller without declaration inheritance',()=>{
    publicLibrary();write('src/routes/api/fake/+server.ts',"import {FakeController} from '@beeblock/svelar/console';const controller=new FakeController();export const POST=controller.handle('save');");
    expect(workflow().map(item=>item.rule)).toEqual(['controller-flow','write-flow']);
  });
  it('still catches direct route CRUD even when a legitimate library controller is imported',()=>{
    publicLibrary();write('src/lib/models/User.ts',"import {Model} from '@beeblock/svelar/orm';export class User extends Model {}");
    write('src/routes/api/unsafe/+server.ts',"import {PublicConsole} from '@beeblock/svelar/console';import {User} from '$lib/models/User.js';export async function POST(){await User.query().delete();return new PublicConsole().handle('save');}");
    expect(lint()).toEqual(expect.arrayContaining([expect.objectContaining({rule:'thin-routes',severity:'error'}),expect.objectContaining({rule:'repository-persistence'})]));
  });
  it.each(['interface','alias','namespace'] as const)('accepts reusable actions with an explicit typed DTO %s without HTTP FormRequest imports',kind=>{
    write('src/lib/contracts/payload.ts','export interface SaveDto {name:string} export type Payload=Readonly<SaveDto>;');
    write('src/lib/contracts/index.ts',"export type {SaveDto as Renamed,Payload} from './payload.js';");
    const imports=kind==='interface'?"import type {SaveDto as Data} from '$lib/contracts/payload.js';"
      :kind==='namespace'?"import type * as C from '$lib/contracts/index.js';":"import type {Payload as Data} from '$lib/contracts/index.js';";
    write('src/lib/actions/SaveAction.ts',"import {Action} from '@beeblock/svelar/actions';"+imports+`export class SaveAction extends Action {execute(input:${kind==='namespace'?'C.Payload':'Data'}){return input;}}`);
    expect(workflow()).toEqual([]);
  });
  it.each(['zod','valibot'] as const)('recognizes %s schema-output DTO aliases across contracts barrels',kind=>{
    write('src/lib/contracts/schemas/item.schema.ts',kind==='zod'?"import {z} from '@beeblock/svelar/validation';export const itemSchema=z.object({name:z.string()});export type ItemInput=z.output<typeof itemSchema>;"
      :"import {v} from '@beeblock/svelar/validation/valibot';export const itemSchema=v.object({name:v.string()});export type ItemInput=v.InferOutput<typeof itemSchema>;");
    write('src/lib/contracts/payload.ts',"export type {ItemInput as Payload} from './schemas/item.schema.js';");
    write('src/lib/actions/SaveAction.ts',"import {Action} from '@beeblock/svelar/actions';import type {Payload as Data} from '$lib/contracts/payload.js';export class SaveAction extends Action {execute(input:Data){return input;}}");
    expect(workflow()).toEqual([]);
  });
  it('keeps HTTP requirements when a reusable DTO-only action is called with unvalidated request JSON',()=>{
    write('src/lib/contracts/data.ts','export interface PayloadDto {name:string}');
    write('src/lib/actions/SaveAction.ts',"import {Action} from '@beeblock/svelar/actions';import type {PayloadDto} from '../contracts/data.js';export class SaveAction extends Action {execute(input:PayloadDto){return input;}}");
    write('src/lib/controllers/ItemController.ts',"import {Controller} from '@beeblock/svelar/routing';import {SaveAction} from '../actions/SaveAction.js';export class ItemController extends Controller {async store(event:unknown){return new SaveAction().execute(await event.request.json());}}");
    const findings=workflow();expect(findings).toHaveLength(1);expect(findings[0]).toMatchObject({file:'src/lib/controllers/ItemController.ts',rule:'write-flow'});
    expect(findings[0].message).toContain('FormRequest');expect(findings[0].message).toContain('shared schema');
  });
  it('accepts a complete HTTP pipeline with schema output DTOs aliased through the request and action',()=>{
    write('src/lib/contracts/schemas/item.schema.ts',"import {z} from '@beeblock/svelar/validation';export const itemSchema=z.object({name:z.string()});export type Payload=z.infer<typeof itemSchema>;");
    write('src/lib/requests/SaveRequest.ts',"import {FormRequest} from '@beeblock/svelar/routing';import {itemSchema,type Payload} from '../contracts/schemas/item.schema.js';export class SaveRequest extends FormRequest {rules(){return itemSchema;}passedValidation(data:Payload){return data;}}");
    write('src/lib/actions/SaveAction.ts',"import {Action} from '@beeblock/svelar/actions';import type {Payload as Data} from '../contracts/schemas/item.schema.js';export class SaveAction extends Action {execute(input:Data){return input;}}");
    write('src/lib/controllers/ItemController.ts',"import {Controller} from '@beeblock/svelar/routing';import {SaveRequest} from '../requests/SaveRequest.js';import {SaveAction} from '../actions/SaveAction.js';export class ItemController extends Controller {async store(event:unknown){const dto=await SaveRequest.validate(event);return new SaveAction().execute(dto);}}");
    expect(workflow()).toEqual([]);
  });
  it('does not let another controller method satisfy an unvalidated HTTP write',()=>{
    write('src/lib/contracts/schemas/item.schema.ts',"import {z} from '@beeblock/svelar/validation';export const itemSchema=z.object({name:z.string()});export type ItemInput=z.output<typeof itemSchema>;");
    write('src/lib/requests/OtherRequest.ts',"import {FormRequest} from '@beeblock/svelar/routing';import {itemSchema} from '../contracts/schemas/item.schema.js';export class OtherRequest extends FormRequest {rules(){return itemSchema;}}");
    write('src/lib/actions/SaveAction.ts',"import {Action} from '@beeblock/svelar/actions';import type {ItemInput} from '../contracts/schemas/item.schema.js';export class SaveAction extends Action {execute(input:ItemInput){return input;}}");
    write('src/lib/controllers/ItemController.ts',"import {Controller} from '@beeblock/svelar/routing';import {OtherRequest} from '../requests/OtherRequest.js';import {SaveAction} from '../actions/SaveAction.js';export class ItemController extends Controller {store(event:unknown){return new SaveAction().execute(event.request.json());}other(event:unknown){return OtherRequest.validate(event);}}");
    expect(workflow()).toEqual([expect.objectContaining({file:'src/lib/controllers/ItemController.ts',message:expect.stringContaining('FormRequest')})]);
  });
  it('keeps an untyped action warning without requiring HTTP imports in the reusable layer',()=>{
    write('src/lib/actions/SaveAction.ts',"import {Action} from '@beeblock/svelar/actions';export class SaveAction extends Action {execute(input:unknown){return input;}}");
    expect(workflow()).toEqual([expect.objectContaining({message:expect.stringContaining('No linked DTO contract observed')})]);
  });
  it('accepts an explicitly shaped reusable input interface without requiring a DTO name suffix',()=>{
    write('src/lib/actions/RegisterAction.ts',"import {Action} from '@beeblock/svelar/actions';interface RegisterInput {name:string;email:string;}export class RegisterAction extends Action<RegisterInput,unknown> {execute(input:RegisterInput){return input;}}");
    expect(workflow()).toEqual([]);
  });
  it('follows module-scoped request/action instances used by an HTTP page action',()=>{
    write('src/lib/contracts/schemas/item.schema.ts',"import {z} from '@beeblock/svelar/validation';export const itemSchema=z.object({name:z.string()});export type Payload=z.output<typeof itemSchema>;");
    write('src/lib/requests/SaveRequest.ts',"import {FormRequest} from '@beeblock/svelar/routing';import {itemSchema,type Payload} from '../contracts/schemas/item.schema.js';export class SaveRequest extends FormRequest {rules(){return itemSchema;}passedValidation(data:Payload){return data;}}");
    write('src/lib/actions/SaveAction.ts',"import {Action} from '@beeblock/svelar/actions';import type {Payload} from '../contracts/schemas/item.schema.js';export class SaveAction extends Action {execute(input:Payload){return input;}}");
    write('src/routes/edit/+page.server.ts',"import {SaveRequest} from '$lib/requests/SaveRequest.js';import {SaveAction} from '$lib/actions/SaveAction.js';const request=new SaveRequest();const action=new SaveAction();export const actions={save:async(event:unknown)=>{const input=await request.validate(event);return action.execute(input);}};");
    expect(workflow()).toEqual([]);
  });
  it('bounds declaration barrel reads and reports unknown delegates rather than false clean',()=>{
    publicLibrary();write('node_modules/@beeblock/svelar/dist/console/index.d.ts',Array.from({length:140},(_,i)=>`export * from './empty${i}.js';`).join('\n'));
    for(let i=0;i<140;i++)write(`node_modules/@beeblock/svelar/dist/console/empty${i}.d.ts`,`export declare const unrelated${i}:string;`);
    write('src/routes/api/console/+server.ts',"import {Unobservable} from '@beeblock/svelar/console';export const POST=new Unobservable().handle('save');");
    expect(lint()).toEqual(expect.arrayContaining([expect.objectContaining({rule:'analysis-limit',message:expect.stringContaining('128-file')}),expect.objectContaining({rule:'controller-flow'})]));
  });
});
