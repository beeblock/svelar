# Controllers, FormRequests, DTOs And Resources

Read [controllers/routing](../../../../docs/04-controllers-routing.md), [validation/DTOs](../../../../docs/05-validation-dtos.md), [services/actions/repositories](../../../../docs/08-services-actions-repositories.md), [forms](../../../../docs/16-forms.md), [HTTP](../../../../docs/14-http.md) and [errors](../../../../docs/19-error-handling.md). Outside this repo, use the corresponding https://svelar.dev/docs/<guide> pages.

## Generate First

Use make:entity Invoice --module=billing --fields "title:string,total:number" --crud --capability=invoices --scope=team --screen-route=/invoices. Focused make:controller --resource also scaffolds supporting schema/request/DTO/action/service/repository/resource classes. Supply an explicit capability decision or reviewed --public exemption; public exempts functional RBAC only, not auth, policies, validation or CSRF.

Do not implement persistence in +server.ts or combine validation, authorization, writes and response shaping in a page action.

## Thin Route

```typescript
import { resource } from '@beeblock/svelar/routing';
import { InvoiceController } from '$lib/modules/billing/interface/http/controllers/InvoiceController.js';

export const { GET, POST, PUT, DELETE } = resource(InvoiceController);
```

Follow the generator's collection/item route binding; resource controllers use current method names and parameters. Do not invent static Controller.handle calls or bypass instance middleware.

## Write Contract

FormRequest imports the shared schema, authorizes the current event and constructs a typed DTO in passedValidation. The controller delegates to an action/service; repositories own query use cases, models own persistence lifecycle, policies own resource decisions and Resource projects public fields.

Backend FormRequests and frontend Superforms use the same schema. Respect svelar.validation.json: Zod uses @beeblock/svelar/validation with zod4/zod4Client; Valibot uses @beeblock/svelar/validation/valibot with valibot/valibotClient. A DTO is not a replacement for a FormRequest.

## Responses And Errors

Use resources and consistent { data, meta } envelopes, including safe messages/field errors. Enhanced page actions return meta.form on success and failures so results update immediately. Render field validation inline; avoid duplicate validation/success toasts. Include loading, disabled/pending, success/error and empty states.

Browser mutations use apiFetch with same-origin CSRF. Genuine provider protocols such as Pusher signatures/DataTables wire responses are explicit documented exceptions, not permission to invent arbitrary response shapes.

Unknown controller failures use the request-scoped global ErrorHandler. Custom handleError overrides allow Response | Promise<Response> and return/await super.handleError(error, event). Preserve native SvelteKit redirects/HTTP errors and safe production incident IDs; do not expose driver/stack/secret details.
