import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import ts from 'typescript';
import { parse } from 'svelte/compiler';
import { MakeDashboardCommand } from '../src/cli/commands/MakeDashboardCommand.js';

const dependencies = process.env.SVELAR_DASHBOARD_TYPE_DEPS;
it.skipIf(!dependencies)('strictly checks generated console bindings with an existing installed Svelte checker',()=>{
  const root=mkdtempSync(join(process.cwd(),'.test-dashboard-types-'));
  try {
    symlinkSync(resolve(dependencies!),join(root,'node_modules'),'dir');
    const files=new MakeDashboardCommand().files({public:true,scope:'platform',route:'/admin/dashboard'},'$lib/shared/permissions/access.server.js');
    for(const file of files.filter(file=>file.path.endsWith('+page.svelte')||file.path.endsWith('contracts.ts')||file.path.endsWith('helpers.ts')||file.path.endsWith('CapabilityEditor.svelte'))) {
      let content=file.content;
      if(file.path.endsWith('CapabilityEditor.svelte')) {
        // Keep the real pattern's typed public props; shadcn installation is tested in the parent app, not this fixture.
        const ast=parse(content,{modern:true});
        const program=ast.instance!.content;
        if(!('start' in program)||!('end' in program)||typeof program.start!=='number'||typeof program.end!=='number')throw new Error('Svelte script positions unavailable.');
        const script=ts.createSourceFile('pattern.ts',content.slice(program.start,program.end),ts.ScriptTarget.Latest,true);
        const props=script.statements.find(node=>ts.isInterfaceDeclaration(node)&&node.name.text==='Props');
        if(!props)throw new Error('Capability editor props not found.');
        content='<script lang="ts">\nimport type {ManifestCapability,ManifestAlias,CapabilityScope} from "$lib/shared/components/patterns/contracts.js";\n'
          +props.getText(script)+'\nlet {catalog,aliases,scope,value=$bindable([]),mode,defaults,inclusions=$bindable([]),exclusions=$bindable([]),disabled,error,onchange}:Props=$props();\n</script>\n<div></div>';
      }
      const path=join(root,file.path);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,content);
    }
    writeFileSync(join(root,'src/routes/admin/dashboard/$types.d.ts'),
      'export interface PageData {panels:Record<string,{data:unknown;meta:Record<string,unknown>;error:string}>;selection:Record<string,string>;tab:string;}');
    writeFileSync(join(root,'src/app-stubs.d.ts'),`declare module '$app/state' {export const page:{url:URL;state:Record<string,unknown>};}
declare module '$app/navigation' {export function goto(url:URL|string,options?:{keepFocus?:boolean;noScroll?:boolean}):Promise<void>;export function replaceState(url:URL|string,state:Record<string,unknown>):void;}`);
    writeFileSync(join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,skipLibCheck:true,target:'ES2022',module:'ESNext',moduleResolution:'Bundler',lib:['ES2022','DOM','DOM.Iterable'],types:['svelte','node'],paths:{
      '@beeblock/svelar/dashboard':[resolve('src/dashboard/index.ts')],
      '@beeblock/svelar/dashboard/schemas':[resolve('src/dashboard/schemas.ts')],
      '@beeblock/svelar/http':[resolve('src/http/index.ts')],
      '@beeblock/svelar/permissions':[resolve('src/permissions/index.ts')],
      '@beeblock/svelar/operations':[resolve('src/operations/index.ts')],
      '$lib/*':[join(root,'src/lib/*')],
    }},include:['src/**/*.ts','src/**/*.svelte',resolve('src/types/externals.d.ts')]}));
    let output='';
    try { output=execFileSync(process.execPath,[join(root,'node_modules/svelte-check/bin/svelte-check'),'--workspace',root,'--tsconfig',join(root,'tsconfig.json'),'--output','human'],{encoding:'utf8',timeout:60_000,maxBuffer:2_000_000}); }
    catch(error) { const details=error as {stdout?:string;stderr?:string}; throw new Error(String(details.stdout??'')+String(details.stderr??'')); }
    expect(output).toContain('0 errors');
  } finally {rmSync(root,{recursive:true,force:true});}
},90_000);
