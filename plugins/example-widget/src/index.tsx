import { useState } from 'react';
import type { AtlasPlugin, AtlasPluginApi, PluginManifest } from '@atlas/plugin-sdk';
import manifest from '../manifest.json';

/**
 * Home-grid widget. Renders with Atlas's React (no bundled React) and receives the typed
 * {@link AtlasPluginApi} bridge as a prop.
 */
function Widget({ api }: { api: AtlasPluginApi }) {
  const [count, setCount] = useState(0);
  return (
    <div className="atlas-example-widget">
      <h3>{manifest.name}</h3>
      <p>Scaffolded with create-atlas-plugin.</p>
      <button
        type="button"
        onClick={() => {
          const next = count + 1;
          setCount(next);
          api.ui.toast('info', manifest.name, `Clicked ${next} time${next === 1 ? '' : 's'}`);
        }}
      >
        Clicked {count} times
      </button>
    </div>
  );
}

const plugin: AtlasPlugin = {
  manifest: manifest as unknown as PluginManifest,
  Widget,
};

export default plugin;
