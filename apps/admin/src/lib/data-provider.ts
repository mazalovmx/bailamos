import type {DataProvider} from '@refinedev/core';
// Thrown for every non-2xx answer of the panel's own API; `message` is the UPPER_SNAKE error code.
export class ApiFailure extends Error {
  statusCode: number;
  constructor(public code: string, status: number, public fields: string[] = []) {super(code); this.statusCode = status;}
}
export async function api<T>(path: string, init: {method?: string; body?: unknown} = {}): Promise<T> {
  const response = await fetch(path, {method: init.method ?? 'GET', credentials: 'same-origin',
    ...(init.body === undefined ? {} : {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(init.body)})});
  const data = await response.json().catch(() => ({}));
  // The session ended or the account lost its staff role: nothing in the panel works any more.
  if (response.status === 401 && window.location.pathname !== '/login') window.location.assign('/login');
  if (!response.ok) throw new ApiFailure(typeof data.error === 'string' ? data.error : typeof data.code === 'string' ? data.code : 'GENERIC', response.status, data.fields);
  return data as T;
}
export const errorCode = (error: unknown) => error instanceof ApiFailure ? error.code : 'GENERIC';
const path = (resource: string, id?: string | number) => '/api/resources/' + resource + (id === undefined ? '' : '/' + encodeURIComponent(String(id)));
// Refine data provider over the generic REST handlers in app/api/resources.
export const dataProvider: DataProvider = {
  getApiUrl: () => '/api',
  getList: ({resource, pagination, sorters, filters}) => {
    const query = new URLSearchParams();
    if (pagination?.mode === 'off') query.set('pageSize', '200');
    else {query.set('page', String(pagination?.currentPage ?? 1)); query.set('pageSize', String(pagination?.pageSize ?? 25));}
    if (sorters?.[0]) {query.set('sort', sorters[0].field); query.set('order', sorters[0].order);}
    for (const filter of filters ?? []) {
      if (!('field' in filter) || filter.value === undefined || filter.value === '') continue;
      const value = Array.isArray(filter.value) ? filter.value.join(',') : String(filter.value);
      if (filter.field === 'q') query.set('q', value);
      else query.append(filter.operator === 'eq' ? filter.field : filter.field + '__' + filter.operator, value);
    }
    return api(path(resource) + '?' + query);
  },
  getOne: ({resource, id}) => api(path(resource, id)),
  create: ({resource, variables}) => api(path(resource), {method: 'POST', body: variables}),
  update: ({resource, id, variables}) => api(path(resource, id), {method: 'PATCH', body: variables}),
  deleteOne: ({resource, id, variables}) => api(path(resource, id), {method: 'DELETE', body: variables ?? {}}),
  custom: async ({url, method, payload, query}) => {
    const search = query ? '?' + new URLSearchParams(query as Record<string, string>) : '';
    return {data: await api(url + search, {method: method.toUpperCase(), body: payload})};
  }
};
