import { Config } from '@stencil/core';

export const config: Config = {
  namespace: 'leaktest',
  outputTargets: [
    {
      type: 'dist-hydrate-script',
      dir: 'hydrate',
    },
  ],
};
