'use client';

import { useMemo, useRef, useState } from 'react';

import { Badge } from '@helix/design-system/components/badge';
import { Button } from '@helix/design-system/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helix/design-system/components/card';
import { Checkbox } from '@helix/design-system/components/checkbox';
import { Input } from '@helix/design-system/components/input';
import { Label } from '@helix/design-system/components/label';
import {
  NativeSelect,
  NativeSelectOption,
} from '@helix/design-system/components/native-select';
import { Separator } from '@helix/design-system/components/separator';
import { Switch } from '@helix/design-system/components/switch';
import { cn } from '@helix/design-system/lib/utils';
import { Hammer, Loader2, Plus, Trash2 } from 'lucide-react';

import type { BuildCatalog } from '@helix/backend/releases';

export type FirmwareBuildValues = {
  name: string;
  version: string;
  channel: string;
  chip: string;
  flashSize: string;
  apps: string[];
  features: string[];
  set: Record<string, string>;
};

export type FirmwareBuilderFormProps = {
  catalog: BuildCatalog;
  submitting?: boolean;
  disabled?: boolean;
  onSubmit: (values: FirmwareBuildValues) => void;
};

type Override = { id: number; key: string; value: string };

const uniqueStrings = (values: string[]): string[] => [...new Set(values)];

export const FirmwareBuilderForm = ({
  catalog,
  submitting = false,
  disabled = false,
  onSubmit,
}: FirmwareBuilderFormProps) => {
  const overrideId = useRef(0);
  const [name, setName] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [channel, setChannel] = useState(catalog.defaults.channel);
  const [chip, setChip] = useState(catalog.defaults.chip);
  const [flashSize, setFlashSize] = useState(catalog.defaults.flashSize);
  const [selectedApps, setSelectedApps] = useState<string[]>([]);
  const [toggledFeatures, setToggledFeatures] = useState<string[]>([]);
  const [knobValues, setKnobValues] = useState<Record<string, string>>({});
  const [overrides, setOverrides] = useState<Override[]>([]);

  // Fragments a selected app needs are force-enabled; the build pulls them in regardless of toggles.
  const requiredFeatures = useMemo(() => {
    const required = new Set<string>();
    for (const app of catalog.apps) {
      if (selectedApps.includes(app.name)) {
        app.features.forEach((feature) => required.add(feature));
      }
    }
    return required;
  }, [catalog.apps, selectedApps]);

  const toggleApp = (appName: string, checked: boolean) => {
    setSelectedApps((current) =>
      checked ? uniqueStrings([...current, appName]) : current.filter((n) => n !== appName),
    );
  };

  const toggleFeature = (key: string, checked: boolean) => {
    setToggledFeatures((current) =>
      checked ? uniqueStrings([...current, key]) : current.filter((k) => k !== key),
    );
  };

  const setKnob = (key: string, value: string) => {
    setKnobValues((current) => ({ ...current, [key]: value }));
  };

  const addOverride = () => {
    overrideId.current += 1;
    setOverrides((current) => [...current, { id: overrideId.current, key: '', value: '' }]);
  };

  const updateOverride = (id: number, patch: Partial<Override>) => {
    setOverrides((current) => current.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  };

  const removeOverride = (id: number) => {
    setOverrides((current) => current.filter((o) => o.id !== id));
  };

  const canSubmit = name.trim() !== '' && version.trim() !== '' && !submitting && !disabled;

  const handleSubmit = () => {
    if (!canSubmit) {
      return;
    }
    const features = uniqueStrings([...toggledFeatures, ...requiredFeatures]);
    const set: Record<string, string> = {};
    for (const [key, value] of Object.entries(knobValues)) {
      if (value.trim() !== '') {
        set[key] = value;
      }
    }
    for (const override of overrides) {
      if (override.key.trim() !== '') {
        set[override.key.trim()] = override.value;
      }
    }
    onSubmit({
      name: name.trim(),
      version: version.trim(),
      channel: channel.trim() === '' ? catalog.defaults.channel : channel.trim(),
      chip,
      flashSize,
      apps: selectedApps,
      features,
      set,
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Release</CardTitle>
          <CardDescription>How this firmware is named, versioned, and channeled.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="fw-name">Name</Label>
            <Input
              id="fw-name"
              placeholder="my-sensor-fw"
              value={name}
              onChange={(e) => { setName(e.target.value); }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="fw-version">Version</Label>
            <Input
              id="fw-version"
              placeholder="1.0.0"
              value={version}
              onChange={(e) => { setVersion(e.target.value); }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="fw-channel">Channel</Label>
            <Input
              id="fw-channel"
              placeholder="custom"
              value={channel}
              onChange={(e) => { setChannel(e.target.value); }}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Target</CardTitle>
          <CardDescription>The chip and flash size this image is built for.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="fw-chip">Chip</Label>
            <NativeSelect
              className="w-full"
              id="fw-chip"
              value={chip}
              onChange={(e) => { setChip(e.target.value); }}
            >
              {catalog.chips.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="fw-flash">Flash size</Label>
            <NativeSelect
              className="w-full"
              id="fw-flash"
              value={flashSize}
              onChange={(e) => { setFlashSize(e.target.value); }}
            >
              {catalog.flashSizes.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Applications</CardTitle>
          <CardDescription>The device apps compiled into this firmware.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {catalog.apps.map((app) => (
            <label
              key={app.name}
              className="hover:bg-accent/50 flex cursor-pointer items-start gap-3 rounded-md border p-3"
              htmlFor={`app-${app.name}`}
            >
              <Checkbox
                checked={selectedApps.includes(app.name)}
                id={`app-${app.name}`}
                onCheckedChange={(checked) => { toggleApp(app.name, checked === true); }}
              />
              <div className="grid gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{app.label}</span>
                  <code className="text-muted-foreground text-xs">{app.name}</code>
                  {app.features.map((feature) => (
                    <Badge key={feature} variant="outline">
                      {feature}
                    </Badge>
                  ))}
                </div>
                {app.description !== '' && (
                  <p className="text-muted-foreground text-xs">{app.description}</p>
                )}
              </div>
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Feature fragments</CardTitle>
          <CardDescription>
            Compile-time options that add or remove firmware capabilities. Fragments a selected app
            requires are enabled automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {catalog.features.map((feature) => {
            const required = requiredFeatures.has(feature.key);
            const checked = required || toggledFeatures.includes(feature.key);
            return (
              <div key={feature.key} className="flex items-start justify-between gap-3">
                <div className="grid gap-1">
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-medium">{feature.key}</code>
                    {required ? <Badge variant="secondary">required by app</Badge> : null}
                  </div>
                  {feature.description !== '' && (
                    <p className="text-muted-foreground text-xs">{feature.description}</p>
                  )}
                </div>
                <Switch
                  checked={checked}
                  disabled={required || disabled}
                  onCheckedChange={(value) => { toggleFeature(feature.key, value); }}
                />
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>sdkconfig overrides</CardTitle>
          <CardDescription>Tune individual ESP-IDF sdkconfig values.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {catalog.sdkconfig.map((knob) => (
            <div key={knob.key} className="grid gap-2">
              <Label htmlFor={`knob-${knob.key}`}>{knob.label}</Label>
              {knob.type === 'select' && knob.options !== undefined ? (
                <NativeSelect
                  className="w-full"
                  id={`knob-${knob.key}`}
                  value={knobValues[knob.key] ?? ''}
                  onChange={(e) => { setKnob(knob.key, e.target.value); }}
                >
                  <NativeSelectOption value="">Default</NativeSelectOption>
                  {knob.options.map((option) => (
                    <NativeSelectOption key={option.value} value={option.value}>
                      {option.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              ) : (
                <Input
                  id={`knob-${knob.key}`}
                  value={knobValues[knob.key] ?? ''}
                  onChange={(e) => { setKnob(knob.key, e.target.value); }}
                />
              )}
              {knob.description !== '' && (
                <p className="text-muted-foreground text-xs">
                  <code>{knob.key}</code> — {knob.description}
                </p>
              )}
            </div>
          ))}

          <Separator />

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>Additional overrides</Label>
              <Button size="sm" type="button" variant="outline" onClick={addOverride}>
                <Plus className="size-4" />
                Add
              </Button>
            </div>
            {overrides.length === 0 && (
              <p className="text-muted-foreground text-xs">
                Raw <code>KEY=VALUE</code> sdkconfig fragments, e.g.{' '}
                <code>CONFIG_HELIX_TRANSPORT_MQTT=n</code>.
              </p>
            )}
            {overrides.map((override) => (
              <div key={override.id} className={cn('flex items-center gap-2')}>
                <Input
                  className="font-mono"
                  placeholder="CONFIG_KEY"
                  value={override.key}
                  onChange={(e) => { updateOverride(override.id, { key: e.target.value }); }}
                />
                <span className="text-muted-foreground">=</span>
                <Input
                  className="font-mono"
                  placeholder="value"
                  value={override.value}
                  onChange={(e) => { updateOverride(override.id, { value: e.target.value }); }}
                />
                <Button
                  size="icon"
                  type="button"
                  variant="ghost"
                  onClick={() => { removeOverride(override.id); }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button disabled={!canSubmit} type="button" onClick={handleSubmit}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : <Hammer className="size-4" />}
          Build firmware
        </Button>
      </div>
    </div>
  );
};
