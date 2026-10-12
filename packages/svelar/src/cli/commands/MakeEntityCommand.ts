/**
 * make:entity — Generate a layered module entity scaffold.
 */

import { Command, type ModuleArtifactKind } from '../Command.js';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Field = {
  name: string;
  kind: string;
  optional: boolean;
  enumValues: string[];
};

export class MakeEntityCommand extends Command {
  name = 'make:entity';
  description = 'Create a model, schema, DTOs, requests, actions, resource, repository, service, controller, and migration';
  arguments = ['name'];
  flags = [
    { name: 'module', description: 'Module name (defaults to plural entity name)', type: 'string' as const },
    { name: 'fields', description: 'Comma-separated fields, e.g. "name:string,description:text?,status:enum(draft,published)"', type: 'string' as const },
    { name: 'crud', description: 'Generate update/delete actions and controller methods', type: 'boolean' as const },
    { name: 'no-migration', description: 'Skip migration generation', type: 'boolean' as const },
    { name: 'controller', description: 'Controller class name (defaults to the entity name)', type: 'string' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const rawName = this.generatorName(args[0], flags);
    if (!rawName) {
      this.error('Please provide an entity name. Example: npx svelar make:entity Invoice --module billing');
      return;
    }

    const name = this.toPascalCase(rawName);
    const moduleName = flags.module || this.toKebabCase(this.pluralize(name));
    const fields = this.parseFields(String(flags.fields ?? ''));
    for (const field of fields) this.validateIdentifier(field.name, 'Field name');
    this.preflightModuleFiles(moduleName, {
      model: `${name}.ts`, schema: `${this.toKebabCase(name)}.schema.ts`, dto: `${name}Dtos.ts`,
      repository: `${name}Repository.ts`, service: `${name}Service.ts`, action: `${name}Actions.ts`,
      request: `${name}Requests.ts`, resource: `${name}Resource.ts`,
      controller: `${flags.controller ? this.toPascalCase(flags.controller).replace(/Controller$/, '') : name}Controller.ts`,
    });
    const migrationFileName = flags['no-migration'] ? undefined
      : `${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}_create_${this.toSnakeCase(this.pluralize(name))}_table.ts`;
    if (migrationFileName) {
      this.artifactPath(this.containedPath(join(process.cwd(), 'src', 'lib'), 'database', 'migrations'),
        migrationFileName);
    }

    if (!flags.module && this.isDDD()) {
      this.warn(`No --module specified. Using "${moduleName}" as module. Consider: --module ${moduleName}`);
    }

    this.writeModel(moduleName, name, fields);
    this.writeSchema(moduleName, name, fields);
    this.writeDtos(moduleName, name, fields, Boolean(flags.crud));
    this.writeRepository(moduleName, name);
    this.writeService(moduleName, name, fields, Boolean(flags.crud));
    this.writeActions(moduleName, name, Boolean(flags.crud));
    this.writeRequests(moduleName, name, Boolean(flags.crud));
    this.writeResource(moduleName, name, fields);
    this.writeController(moduleName, name, Boolean(flags.crud), flags.controller);

    if (migrationFileName) {
      this.writeMigration(name, fields, migrationFileName);
    }
  }

  private writeModel(moduleName: string, name: string, fields: Field[]): void {
    const tableName = this.toSnakeCase(this.pluralize(name));
    const fillable = fields.map((field) => `'${field.name}'`).join(', ');
    const casts = fields.filter((field) => ['number', 'integer', 'boolean', 'date'].includes(field.kind))
      .map((field) => `    ${field.name}: '${field.kind === 'integer' ? 'number' : field.kind}',`);
    this.writeModuleFile(moduleName, 'models', 'model', `${name}.ts`, `import { Model } from '@beeblock/svelar/orm';

export class ${name} extends Model {
  static table = '${tableName}';
  static timestamps = true;
  static fillable = [${fillable}];
  static casts = {
    id: 'number',
${casts.join('\n')}
    created_at: 'date',
    updated_at: 'date',
  } as const;

  declare id: number;
${fields.map((field) => `  declare ${field.name}: ${this.tsType(field)};`).join('\n')}
  declare created_at: Date;
  declare updated_at: Date;
}
`);
  }

  private writeSchema(moduleName: string, name: string, fields: Field[]): void {
    const lower = this.toCamelCase(name);
    const fileName = `${this.toKebabCase(name)}.schema.ts`;
    const validation = this.validationProvider();
    const fieldLines = fields.map((field) => `  ${field.name}: ${validation === 'valibot' ? this.valibotFor(field) : this.zodFor(field)},`);
    const dataLines = fields.map((field) => `  ${field.name}: ${validation === 'valibot' ? this.valibotFor(field, true) : this.zodFor(field, true)},`);
    const numberNormalizer = "const normalizeNumber = (input: unknown) => typeof input === 'string' && input.trim() !== '' ? Number(input) : input;";
    const booleanNormalizer = `const normalizeBoolean = (input: unknown) => {
  if (input === true || input === 1 || input === 'true' || input === 'on' || input === '1') return true;
  if (input === false || input === 0 || input === 'false' || input === 'off' || input === '0') return false;
  return input;
};`;
    const dateNormalizer = "const normalizeDate = (input: unknown) => typeof input === 'string' && input.trim() !== '' ? new Date(input) : input;";
    const needsBoolean = fields.some((field) => field.kind === 'boolean');
    const needsDate = fields.some((field) => field.kind === 'date');

    if (validation === 'valibot') {
      const helpers = [
        numberNormalizer,
        "const numberInput = () => v.pipe(v.unknown(), v.transform(normalizeNumber), v.number(), v.finite());",
        needsBoolean ? `${booleanNormalizer}\nconst booleanInput = () => v.pipe(v.unknown(), v.transform(normalizeBoolean), v.boolean());` : '',
        needsDate ? `${dateNormalizer}\nconst dateInput = () => v.pipe(v.unknown(), v.transform(normalizeDate), v.date());` : '',
      ].filter(Boolean).join('\n');

      this.writeModuleFile(moduleName, 'schemas', 'schema', fileName, `import { v } from '@beeblock/svelar/validation/valibot';
${helpers ? `\n${helpers}\n` : ''}
export const ${lower}IdSchema = v.pipe(numberInput(), v.integer(), v.minValue(1));

export const ${lower}Schema = v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(1)),
${dataLines.join('\n')}
  created_at: v.pipe(v.string(), v.isoTimestamp()),
  updated_at: v.pipe(v.string(), v.isoTimestamp()),
});

export const create${name}Schema = v.object({
${fieldLines.join('\n')}
});

export const update${name}Schema = v.partial(create${name}Schema);

export type ${name}Data = v.InferOutput<typeof ${lower}Schema>;
export type Create${name}Input = v.InferOutput<typeof create${name}Schema>;
export type Update${name}Input = v.InferOutput<typeof update${name}Schema>;
`);
      return;
    }

    this.writeModuleFile(moduleName, 'schemas', 'schema', fileName, `import { z } from '@beeblock/svelar/validation';

${numberNormalizer}
const numberInput = (schema: z.ZodNumber = z.number().finite()) => z.preprocess(normalizeNumber, schema);
${needsBoolean ? `${booleanNormalizer}\nconst booleanInput = () => z.preprocess(normalizeBoolean, z.boolean());\n` : ''}${needsDate ? `${dateNormalizer}\nconst dateInput = () => z.preprocess(normalizeDate, z.date());\n` : ''}
export const ${lower}IdSchema = numberInput(z.number().int().positive());

export const ${lower}Schema = z.object({
  id: z.number().int().positive(),
${dataLines.join('\n')}
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const create${name}Schema = z.object({
${fieldLines.join('\n')}
});

export const update${name}Schema = create${name}Schema.partial();

export type ${name}Data = z.infer<typeof ${lower}Schema>;
export type Create${name}Input = z.infer<typeof create${name}Schema>;
export type Update${name}Input = z.infer<typeof update${name}Schema>;
`);
  }

  private writeDtos(moduleName: string, name: string, fields: Field[], crud: boolean): void {
    const dtoPath = this.moduleImportPath(moduleName, 'dto', 'schema', `${this.toKebabCase(name)}.schema`);
    const createAssignments = fields.map((field) => `    public readonly ${field.name}: ${this.tsType(field)}${field.optional ? ' | undefined' : ''},`).join('\n');
    const updateAssignments = fields.map((field) => `    public readonly ${field.name}: ${this.tsType(field)} | undefined,`).join('\n');
    const args = fields.map((field) => `      input.${field.name},`).join('\n');
    let content = `import type { Create${name}Input${crud ? `, Update${name}Input` : ''} } from '${dtoPath}';

export class Create${name}Dto {
  constructor(
${createAssignments}
  ) {}

  static from(input: Create${name}Input): Create${name}Dto {
    return new Create${name}Dto(
${args}
    );
  }
}
`;

    if (crud) {
      content += `
export class Update${name}Dto {
  constructor(
    public readonly id: number,
${updateAssignments}
  ) {}

  static from(id: number, input: Update${name}Input): Update${name}Dto {
    return new Update${name}Dto(
      id,
${args}
    );
  }
}

export class Delete${name}Dto {
  constructor(public readonly id: number) {}
}
`;
    }

    this.writeModuleFile(moduleName, 'dtos', 'dto', `${name}Dtos.ts`, content);
  }

  private writeRepository(moduleName: string, name: string): void {
    const modelPath = this.moduleImportPath(moduleName, 'repository', 'model', name);
    this.writeModuleFile(moduleName, 'repositories', 'repository', `${name}Repository.ts`, `import { Repository } from '@beeblock/svelar/repositories';
import { ${name} } from '${modelPath}';

export class ${name}Repository extends Repository<${name}> {
  model() {
    return ${name};
  }
}
`);
  }

  private writeService(moduleName: string, name: string, fields: Field[], crud: boolean): void {
    const repoPath = this.moduleImportPath(moduleName, 'service', 'repository', `${name}Repository`);
    const dtoPath = this.moduleImportPath(moduleName, 'service', 'dto', `${name}Dtos`);
    this.writeModuleFile(moduleName, 'services', 'service', `${name}Service.ts`, `import { Service } from '@beeblock/svelar/services';
import { ${name}Repository } from '${repoPath}';
import type { Create${name}Dto${crud ? `, Update${name}Dto` : ''} } from '${dtoPath}';

const repository = new ${name}Repository();

export class ${name}Service extends Service {
  async list() {
    return repository.all();
  }

  async create(dto: Create${name}Dto) {
    return repository.create({
${fields.map((field) => `      ${field.name}: dto.${field.name}${field.optional ? ' ?? null' : ''},`).join('\n')}
    });
  }

  async find(id: number) {
    return repository.findByIdOrFail(id);
  }

${crud ? `  async update(dto: Update${name}Dto) {
    const { id, ...attributes } = dto;
    const changes = Object.fromEntries(Object.entries(attributes).filter(([, value]) => value !== undefined));
    return repository.update(id, changes);
  }

  async delete(id: number) {
    await repository.delete(id);
  }
` : ''}
}
`);
  }

  private writeActions(moduleName: string, name: string, crud: boolean): void {
    const servicePath = this.moduleImportPath(moduleName, 'action', 'service', `${name}Service`);
    const dtoPath = this.moduleImportPath(moduleName, 'action', 'dto', `${name}Dtos`);
    const modelPath = this.moduleImportPath(moduleName, 'action', 'model', name);
    let content = `import { Action } from '@beeblock/svelar/actions';
import { ${name}Service } from '${servicePath}';
import type { Create${name}Dto${crud ? `, Delete${name}Dto, Update${name}Dto` : ''} } from '${dtoPath}';
import type { ${name} } from '${modelPath}';

const service = new ${name}Service();

export class Create${name}Action extends Action<Create${name}Dto, ${name}> {
  async execute(dto: Create${name}Dto): Promise<${name}> {
    return service.create(dto);
  }
}
`;

    if (crud) {
      content += `
export class Update${name}Action extends Action<Update${name}Dto, ${name}> {
  async execute(dto: Update${name}Dto): Promise<${name}> {
    return service.update(dto);
  }
}

export class Delete${name}Action extends Action<Delete${name}Dto, void> {
  async execute(dto: Delete${name}Dto): Promise<void> {
    await service.delete(dto.id);
  }
}
`;
    }

    this.writeModuleFile(moduleName, 'actions', 'action', `${name}Actions.ts`, content);
  }

  private writeRequests(moduleName: string, name: string, crud: boolean): void {
    const dtoPath = this.moduleImportPath(moduleName, 'request', 'dto', `${name}Dtos`);
    const schemaPath = this.moduleImportPath(moduleName, 'request', 'schema', `${this.toKebabCase(name)}.schema`);
    const validation = this.validationProvider();
    const idSchema = `${this.toCamelCase(name)}IdSchema`;
    let content = validation === 'valibot'
      ? `import { FormRequest } from '@beeblock/svelar/forms';
import { v } from '@beeblock/svelar/validation/valibot';
import type { RequestEvent } from '@beeblock/svelar/routing';
import { Create${name}Dto${crud ? `, Delete${name}Dto, Update${name}Dto` : ''} } from '${dtoPath}';
import { create${name}Schema${crud ? `, update${name}Schema, ${idSchema} as idSchema` : ''} } from '${schemaPath}';
import type { Create${name}Input${crud ? `, Update${name}Input` : ''} } from '${schemaPath}';

${crud ? `
const update${name}WithIdSchema = v.intersect([update${name}Schema, v.object({ id: idSchema })]);
const delete${name}Schema = v.object({ id: idSchema });
` : ''}

export class Create${name}Request extends FormRequest<typeof create${name}Schema, Create${name}Dto> {
  rules() {
    return create${name}Schema;
  }

  authorize(event: RequestEvent): boolean {
    return !!event.locals.user;
  }

  passedValidation(data: Create${name}Input): Create${name}Dto {
    return Create${name}Dto.from(data);
  }
}
`
      : `import { FormRequest } from '@beeblock/svelar/forms';
import { z } from '@beeblock/svelar/validation';
import type { RequestEvent } from '@beeblock/svelar/routing';
import { Create${name}Dto${crud ? `, Delete${name}Dto, Update${name}Dto` : ''} } from '${dtoPath}';
import { create${name}Schema${crud ? `, update${name}Schema, ${idSchema} as idSchema` : ''} } from '${schemaPath}';
import type { Create${name}Input${crud ? `, Update${name}Input` : ''} } from '${schemaPath}';
${crud ? `
const update${name}WithIdSchema = update${name}Schema.extend({ id: idSchema });
const delete${name}Schema = z.object({ id: idSchema });
` : ''}

export class Create${name}Request extends FormRequest<typeof create${name}Schema, Create${name}Dto> {
  rules() {
    return create${name}Schema;
  }

  authorize(event: RequestEvent): boolean {
    return !!event.locals.user;
  }

  passedValidation(data: Create${name}Input): Create${name}Dto {
    return Create${name}Dto.from(data);
  }
}
`;

    if (crud) {
      content += validation === 'valibot'
? `
export class Update${name}Request extends FormRequest<typeof update${name}WithIdSchema, Update${name}Dto> {
  rules() {
    return update${name}WithIdSchema;
  }

  authorize(event: RequestEvent): boolean {
    return !!event.locals.user;
  }

  passedValidation(data: Update${name}Input & { id: number }): Update${name}Dto {
    return Update${name}Dto.from(Number(data.id), data);
  }
}

export class Delete${name}Request extends FormRequest<typeof delete${name}Schema, Delete${name}Dto> {
  rules() {
    return delete${name}Schema;
  }

  authorize(event: RequestEvent): boolean {
    return !!event.locals.user;
  }

  passedValidation(data: { id: number }): Delete${name}Dto {
    return new Delete${name}Dto(Number(data.id));
  }
}
`
        : `
export class Update${name}Request extends FormRequest<typeof update${name}WithIdSchema, Update${name}Dto> {
  rules() {
    return update${name}WithIdSchema;
  }

  authorize(event: RequestEvent): boolean {
    return !!event.locals.user;
  }

  passedValidation(data: Update${name}Input & { id: number }): Update${name}Dto {
    return Update${name}Dto.from(Number(data.id), data);
  }
}

export class Delete${name}Request extends FormRequest<typeof delete${name}Schema, Delete${name}Dto> {
  rules() {
    return delete${name}Schema;
  }

  authorize(event: RequestEvent): boolean {
    return !!event.locals.user;
  }

  passedValidation(data: { id: number }): Delete${name}Dto {
    return new Delete${name}Dto(Number(data.id));
  }
}
`;
    }

    this.writeModuleFile(moduleName, 'dtos', 'request', `${name}Requests.ts`, content);
  }

  private writeResource(moduleName: string, name: string, fields: Field[]): void {
    const modelPath = this.moduleImportPath(moduleName, 'resource', 'model', name);
    const schemaPath = this.moduleImportPath(moduleName, 'resource', 'schema', `${this.toKebabCase(name)}.schema`);
    this.writeModuleFile(moduleName, 'resources', 'resource', `${name}Resource.ts`, `import { Resource } from '@beeblock/svelar/routing';
import type { ${name} } from '${modelPath}';
import type { ${name}Data } from '${schemaPath}';

export class ${name}Resource extends Resource<${name}, ${name}Data> {
  toJSON(): ${name}Data {
    return {
      id: Number(this.data.id),
${fields.map((field) => `      ${field.name}: this.data.${field.name}${field.kind === 'date' ? `${field.optional ? '?' : ''}.toISOString()` : ''}${field.optional ? ' ?? null' : ''},`).join('\n')}
      created_at: this.data.created_at.toISOString(),
      updated_at: this.data.updated_at.toISOString(),
    };
  }
}
`);
  }

  private writeController(moduleName: string, name: string, crud: boolean, requestedController?: string): void {
    const controllerName = requestedController ? this.toPascalCase(requestedController).replace(/Controller$/, '') + 'Controller' : `${name}Controller`;
    const servicePath = this.moduleImportPath(moduleName, 'controller', 'service', `${name}Service`);
    const resourcePath = this.moduleImportPath(moduleName, 'controller', 'resource', `${name}Resource`);
    const actionsPath = this.moduleImportPath(moduleName, 'controller', 'action', `${name}Actions`);
    const requestsPath = this.moduleImportPath(moduleName, 'controller', 'request', `${name}Requests`);
    let content = `import { Controller, type RequestEvent } from '@beeblock/svelar/routing';
import { ${name}Service } from '${servicePath}';
import { ${name}Resource } from '${resourcePath}';
import { Create${name}Action${crud ? `, Delete${name}Action, Update${name}Action` : ''} } from '${actionsPath}';
import { Create${name}Request${crud ? `, Delete${name}Request, Update${name}Request` : ''} } from '${requestsPath}';

const service = new ${name}Service();
const createAction = new Create${name}Action();
${crud ? `const updateAction = new Update${name}Action();
const deleteAction = new Delete${name}Action();
` : ''}
export class ${controllerName} extends Controller {
  async index(event: RequestEvent) {
    const items = await service.list();
    return ${name}Resource.collection(items).toResponse();
  }

  async store(event: RequestEvent) {
    const dto = await Create${name}Request.validate(event);
    const item = await createAction.run(dto);
    return ${name}Resource.make(item).status(201).toResponse();
  }

  async show(event: RequestEvent) {
    const item = await service.find(Number(event.params.id));
    return ${name}Resource.make(item).toResponse();
  }
`;

    if (crud) {
      content += `
  async update(event: RequestEvent) {
    const dto = await Update${name}Request.validate(event);
    const item = await updateAction.run(dto);
    return ${name}Resource.make(item).toResponse();
  }

  async destroy(event: RequestEvent) {
    const dto = await Delete${name}Request.validate(event);
    await deleteAction.run(dto);
    return this.noContent();
  }
`;
    }

    content += `}
`;
    this.writeModuleFile(moduleName, 'controllers', 'controller', `${controllerName}.ts`, content);
  }

  private writeMigration(name: string, fields: Field[], fileName: string): void {
    const tableName = this.toSnakeCase(this.pluralize(name));
    const className = `Create${this.pluralize(name)}Table`;
    const migrationsDir = this.containedPath(join(process.cwd(), 'src', 'lib'), 'database', 'migrations');
    const filePath = this.artifactPath(migrationsDir, fileName);
    mkdirSync(migrationsDir, { recursive: true });
    if (readdirSync(migrationsDir).some((file) => file.endsWith(`_create_${tableName}_table.ts`) || file.endsWith(`_create_${tableName}_table.js`))) return;
    writeFileSync(filePath, `import { Migration } from '@beeblock/svelar/database';

export default class ${className} extends Migration {
  async up() {
    await this.schema.createTable('${tableName}', (table) => {
      table.increments('id');
${fields.map((field) => `      ${this.migrationColumn(field)};`).join('\n')}
      table.timestamps();
    });
  }

  async down() {
    await this.schema.dropTableIfExists('${tableName}');
  }
}
`);
    this.success(`Migration created: src/lib/database/migrations/${fileName}`);
  }

  private writeModuleFile(moduleName: string, flatType: string, kind: ModuleArtifactKind, fileName: string, content: string): void {
    const dir = this.moduleDir(moduleName, flatType, kind);
    const filePath = this.artifactPath(dir, fileName);
    mkdirSync(dir, { recursive: true });
    if (existsSync(filePath)) {
      this.warn(`Skipped existing file: ${this.moduleRelDir(moduleName, flatType, kind)}/${fileName}`);
      return;
    }
    writeFileSync(filePath, content);
    this.success(`Created: ${this.moduleRelDir(moduleName, flatType, kind)}/${fileName}`);
  }

  private parseFields(input: string): Field[] {
    if (!input.trim()) return [];
    return this.splitFieldList(input).map((raw) => {
      const [namePart, typePart = 'string'] = raw.trim().split(':');
      const optional = typePart.endsWith('?');
      const kind = optional ? typePart.slice(0, -1) : typePart;
      const enumMatch = kind.match(/^enum\((.+)\)$/);
      return {
        name: this.toCamelCase(namePart.trim()),
        kind: enumMatch ? 'enum' : kind,
        optional,
        enumValues: enumMatch ? enumMatch[1].split('|').flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean) : [],
      };
    });
  }

  private splitFieldList(input: string): string[] {
    const parts: string[] = [];
    let current = '';
    let depth = 0;
    for (const char of input) {
      if (char === '(') depth++;
      if (char === ')') depth = Math.max(0, depth - 1);
      if (char === ',' && depth === 0) {
        if (current.trim()) parts.push(current.trim());
        current = '';
        continue;
      }
      current += char;
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  }

  private zodFor(field: Field, serialized = false): string {
    const base = field.kind === 'number'
      ? serialized ? 'z.number().finite()' : 'numberInput()'
      : field.kind === 'integer'
        ? serialized ? 'z.number().int().finite()' : 'numberInput(z.number().int().finite())'
      : field.kind === 'boolean'
        ? serialized ? 'z.boolean()' : 'booleanInput()'
        : field.kind === 'date'
          ? serialized ? 'z.string().datetime()' : 'dateInput()'
          : field.kind === 'enum'
            ? `z.enum([${field.enumValues.map((value) => `'${value}'`).join(', ')}] as const)`
            : 'z.string().trim()';
    return field.optional ? `${base}.${serialized ? 'nullable' : 'nullish'}()` : base;
  }

  private valibotFor(field: Field, serialized = false): string {
    const base = field.kind === 'number'
      ? serialized ? 'v.pipe(v.number(), v.finite())' : 'numberInput()'
      : field.kind === 'integer'
        ? serialized ? 'v.pipe(v.number(), v.finite(), v.integer())' : 'v.pipe(numberInput(), v.integer())'
      : field.kind === 'boolean'
        ? serialized ? 'v.boolean()' : 'booleanInput()'
        : field.kind === 'date'
          ? serialized ? 'v.pipe(v.string(), v.isoTimestamp())' : 'dateInput()'
          : field.kind === 'enum'
            ? `v.picklist([${field.enumValues.map((value) => `'${value}'`).join(', ')}])`
            : 'v.pipe(v.string(), v.trim())';
    return field.optional ? `v.${serialized ? 'nullable' : 'nullish'}(${base})` : base;
  }

  private tsType(field: Field): string {
    const type = field.kind === 'number' || field.kind === 'integer' ? 'number'
      : field.kind === 'boolean' ? 'boolean'
        : field.kind === 'date' ? 'Date'
          : field.kind === 'enum' && field.enumValues.length > 0
            ? field.enumValues.map((value) => `'${value}'`).join(' | ')
            : 'string';
    return `${type}${field.optional ? ' | null' : ''}`;
  }

  private migrationColumn(field: Field): string {
    const nullable = field.optional ? '.nullable()' : '';
    if (field.kind === 'number') return `table.decimal('${field.name}')${nullable}`;
    if (field.kind === 'integer') return `table.integer('${field.name}')${nullable}`;
    if (field.kind === 'boolean') return `table.boolean('${field.name}')${nullable}.default(false)`;
    if (field.kind === 'date') return `table.timestamp('${field.name}')${nullable}`;
    if (field.kind === 'text') return `table.text('${field.name}')${nullable}`;
    return `table.string('${field.name}')${nullable}`;
  }

  private toPascalCase(str: string): string {
    return str
      .replace(/[-_\s]+(.)?/g, (_match, char) => char ? char.toUpperCase() : '')
      .replace(/^./, (char) => char.toUpperCase());
  }

  private toCamelCase(str: string): string {
    const pascal = this.toPascalCase(str);
    return pascal.charAt(0).toLowerCase() + pascal.slice(1);
  }

  private toKebabCase(str: string): string {
    return str
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
      .replace(/[_\s]+/g, '-')
      .toLowerCase();
  }

  private toSnakeCase(str: string): string {
    return this.toKebabCase(str).replace(/-/g, '_');
  }

  private pluralize(str: string): string {
    if (str.endsWith('y')) return str.slice(0, -1) + 'ies';
    if (str.endsWith('s') || str.endsWith('x') || str.endsWith('z') || str.endsWith('ch') || str.endsWith('sh')) {
      return str + 'es';
    }
    return str + 's';
  }
}
