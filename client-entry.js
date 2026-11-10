import { createProviderLoginClient } from './lib/provider-login-client.js'

window.__ModuleLoader__.load({
  id: 'dsh-devin',
  factory(require) {
    return createProviderLoginClient(require, { id: 'dsh-devin', label: 'Devin', sectionId: 'devin', order: 34, apiPath: '/api/dsh-devin' })
  },
})
