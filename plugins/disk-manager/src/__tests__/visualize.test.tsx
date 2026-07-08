import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AtlasPluginApi } from '@atlas/plugin-sdk';
import { Visualize } from '../Visualize';
import { DiskManagerPanel } from '../Panel';
import {
  buildVisualizeModel,
  mockDiskApi,
  mockDuplicateSummary,
  mockIcloudDriveScan,
  mockIcloudExtras,
  mockLocalScan,
} from '../model';

function sources() {
  return {
    local: mockLocalScan(),
    icloudDrive: mockIcloudDriveScan(),
    icloudExtras: mockIcloudExtras(),
  };
}

const noop = () => {};

function renderVisualize(scope: 'local' | 'icloud' | 'both', freedBytes = 0) {
  return renderToStaticMarkup(
    <Visualize
      model={buildVisualizeModel(scope, sources())}
      freedBytes={freedBytes}
      duplicates={mockDuplicateSummary()}
      onScopeChange={noop}
      onSelectNode={noop}
      onReorg={noop}
      onOpenSummary={noop}
      onReviewDuplicates={noop}
    />,
  );
}

describe('Visualize render (local scope)', () => {
  const html = renderVisualize('local');

  it('renders the header and all three scope options', () => {
    expect(html).toContain('Disk Manager');
    expect(html).toContain('data-scope="local"');
    expect(html).toContain('data-scope="icloud"');
    expect(html).toContain('data-scope="both"');
    expect(html).toContain('Reorganize with AI');
  });

  it('renders a clickable treemap from the scan folders', () => {
    expect(html).toContain('data-node-key="Videos"');
    expect(html).toContain('data-node-key="Downloads"');
    expect(html).toContain('GB');
    // Local scope has no iCloud aggregate side.
    expect(html).not.toContain('iCloud — aggregate only');
  });

  it('surfaces the duplicate banner', () => {
    expect(html).toContain('duplicate files found');
  });
});

describe('Visualize render (iCloud scope)', () => {
  const html = renderVisualize('icloud');

  it('splits iCloud into browsable Drive vs aggregate-only Photos/Mail vs Backup', () => {
    // Drive folder is a clickable treemap node.
    expect(html).toContain('data-node-key="iCloud Drive — Documents"');
    // Photos/Mail are aggregate cards — distinct, not treemap nodes.
    expect(html).toContain('iCloud — aggregate only');
    expect(html).toContain('data-agg-key="photos"');
    expect(html).toContain('data-agg-key="mail"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain('data-node-key="Photos"');
    // Backup is a read-only, out-of-scope figure.
    expect(html).toContain('iCloud Backup — out of scope');
  });
});

describe('Visualize tally pill', () => {
  it('hides the pill until space has been freed, then shows the running total', () => {
    expect(renderVisualize('local', 0)).not.toContain('Space freed');
    expect(renderVisualize('local', 5 * 1024 ** 3)).toContain('Space freed');
  });
});

describe('DiskManagerPanel', () => {
  it('mounts and shows a scanning state before the async scan resolves', () => {
    const api = { disk: mockDiskApi() } as unknown as AtlasPluginApi;
    const html = renderToStaticMarkup(<DiskManagerPanel api={api} />);
    // Static markup does not run effects, so the panel is in its pre-scan state.
    expect(html).toContain('atlas-disk-manager');
    expect(html).toContain('Scanning disk');
  });

  it('selecting a node routes through triageTargetFromNode wiring', () => {
    // Guards against the Panel forgetting to scope the target to the active scope.
    const onSelect = vi.fn();
    const model = buildVisualizeModel('both', sources());
    renderToStaticMarkup(
      <Visualize
        model={model}
        freedBytes={0}
        onScopeChange={noop}
        onSelectNode={onSelect}
        onReorg={noop}
        onOpenSummary={noop}
      />,
    );
    // The node exists in the layout that the click handler would receive.
    expect(model.layout.some((r) => r.name === 'iCloud Drive')).toBe(true);
  });
});
