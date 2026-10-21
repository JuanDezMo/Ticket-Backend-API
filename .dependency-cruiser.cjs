/** Reglas de arquitectura de ticket-api (ver docs/architecture.md, secciones 5 y 9). */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'No se permiten ciclos entre archivos ni entre módulos.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'controller-no-repository',
      severity: 'error',
      comment: 'El controller solo habla con el service, nunca con el repository.',
      from: { path: '^src/modules/[^/]+/[^/]+\\.controller\\.ts$' },
      to: { path: '\\.repository\\.ts$' },
    },
    {
      name: 'service-no-express',
      severity: 'error',
      comment: 'El service no conoce HTTP (req, res, express).',
      from: { path: '^src/modules/[^/]+/[^/]+\\.service\\.ts$' },
      to: { path: 'node_modules/(express|@types/express)' },
    },
    {
      name: 'no-cross-module-repository',
      severity: 'error',
      comment: 'Un módulo puede usar el service de otro módulo, nunca su repository.',
      from: { path: '^src/modules/([^/]+)/' },
      to: { path: '^src/modules/[^/]+/.+\\.repository\\.ts$', pathNot: '^src/modules/$1/' },
    },
    {
      name: 'no-test-code-in-src',
      severity: 'error',
      comment: 'El código de producción no importa tests.',
      from: { path: '^src' },
      to: { path: '^tests' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
