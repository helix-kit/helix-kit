'use client';

import {
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { FileIcon, X } from 'lucide-react';
import { type Accept, useDropzone } from 'react-dropzone';
import { type ControllerRenderProps, type FieldValues, type Path } from 'react-hook-form';

import { Badge } from './badge';
import { Button } from './button';
import { Checkbox } from './checkbox';
import DateInput from './date-input';
import { useDynamicFormContext } from './dynamic-form-context';
import { Input } from './input';
import { Progress } from './progress';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from './select';
import { Textarea } from './textarea';

import { cn } from '../lib/utils';

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) {
    return '0 Bytes';
  }

  const units = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
  const size = bytes / Math.pow(k, i);

  return `${size.toFixed(2)} ${units[i]}`;
};

const PROGRESS_FULL = 100;
const STATUS_CODE_200 = 200;
const STATUS_CODE_300 = 300;

type FileProgressUpdater = (
  fileName: string,
  progress: number,
  status: 'idle' | 'uploading' | 'done' | 'failed',
) => void;

const uploadSingleFile = (
  file: File,
  uploadUrl: string,
  updateFileProgress: FileProgressUpdater,
): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    updateFileProgress(file.name, 0, 'uploading');

    const handleProgress = (event: ProgressEvent) => {
      if (event.lengthComputable) {
        const percentComplete = Math.round((event.loaded / event.total) * PROGRESS_FULL);
        updateFileProgress(file.name, percentComplete, 'uploading');
      }
    };

    const handleLoad = () => {
      if (xhr.status >= STATUS_CODE_200 && xhr.status < STATUS_CODE_300) {
        updateFileProgress(file.name, PROGRESS_FULL, 'done');
        resolve();
      } else {
        updateFileProgress(file.name, 0, 'failed');
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    };

    const handleError = () => {
      updateFileProgress(file.name, 0, 'failed');
      reject(new Error('Upload failed'));
    };

    xhr.upload.addEventListener('progress', handleProgress);
    xhr.addEventListener('load', handleLoad);
    xhr.addEventListener('error', handleError);
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.send(file);
  });
};

type SelectOption = { label: string; value: string };

export type FormField<T extends FieldValues = FieldValues> = {
  name: Path<T>;
  label: string | ReactNode;
  type: keyof typeof RenderedFormFields;
  placeholder?: string;
  description?: string;
  options?: SelectOption[];
  min?: number;
  max?: number;
  step?: number;
  render?: (field: ControllerRenderProps<T, Path<T>>) => ReactNode;
  displayCondition?: ((values: T) => boolean) | boolean;
  maxFiles?: number;
  accept?: Accept;
};

type FieldProps<T extends FieldValues = FieldValues> = {
  field: ControllerRenderProps<T, Path<T>>;
  formField: FormField<T>;
  id: string;
};

const RenderedStringArrayInput = <T extends FieldValues = FieldValues>(props: FieldProps<T>) => {
  const [value, setValue] = useState<string>('');

  if (!Array.isArray(props.field.value)) {
    props.field.onChange([]);
  }
  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === ',' || e.key === 'Enter') {
      e.preventDefault();

      if (value.trim().length > 0) {
        const newValue = [...props.field.value, value.trim()];
        props.field.onChange(newValue);
        setValue('');
      }
    }
  };

  const handleBlur = () => {
    if (value.trim().length > 0) {
      const newValue = [...props.field.value, value.trim()];
      props.field.onChange(newValue);
      setValue('');
    }
    props.field.onBlur();
  };

  const handleRemoveItem = (index: number) => {
    const newValue = [...props.field.value];
    newValue.splice(index, 1);
    props.field.onChange(newValue);
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasteData = e.clipboardData.getData('text');
    const values = pasteData
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    if (values.length > 0) {
      const newValue = [...props.field.value, ...values];
      props.field.onChange(newValue);
    }
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {(props.field.value as string[]).map((item: string, index: number) => (
          <Badge key={item} className="max-w-[320px] px-2 py-1" variant="secondary">
            <span className="min-w-0 truncate">{item}</span>
            <button
              className="text-muted-foreground hover:text-foreground ml-2"
              title="Remove"
              type="button"
              onClick={() => {
                handleRemoveItem(index);
              }}
            >
              <X size={14} />
            </button>
          </Badge>
        ))}
      </div>
      <Input
        placeholder="Type and press Enter or comma to add"
        value={value}
        onBlur={handleBlur}
        onChange={(e) => {
          setValue(e.target.value);
        }}
        onKeyDown={handleInputKeyDown}
        onPaste={handlePaste}
      />
    </>
  );
};

const RenderedTimeInput = <T extends FieldValues = FieldValues>(props: FieldProps<T>) => (
  <Input placeholder={props.formField.placeholder} type="time" {...props.field} />
);

const RenderedDateInput = <T extends FieldValues = FieldValues>(props: FieldProps<T>) => {
  const fieldDate = props.field.value;
  return (
    <DateInput
      date={fieldDate}
      onChange={(date) => {
        const updatedDate = new Date(fieldDate);
        updatedDate.setDate(date.getDate());
        updatedDate.setMonth(date.getMonth());
        updatedDate.setFullYear(date.getFullYear());
        props.field.onChange(updatedDate);
      }}
    />
  );
};

const RenderedDatetimeInput = <T extends FieldValues = FieldValues>(props: FieldProps<T>) => {
  const fieldDate = props.field.value as Date;
  const pad = (n: number) => n.toString().padStart(2, '0');
  const timeValue = `${pad(fieldDate.getHours())}:${pad(fieldDate.getMinutes())}:${pad(fieldDate.getSeconds())}`;
  return (
    <div className="flex gap-4">
      <DateInput
        date={fieldDate}
        onChange={(date) => {
          const updatedDate = new Date(fieldDate);
          updatedDate.setDate(date.getDate());
          updatedDate.setMonth(date.getMonth());
          updatedDate.setFullYear(date.getFullYear());
          props.field.onChange(updatedDate);
        }}
      />
      <Input
        className="bg-background appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
        step="1"
        type="time"
        value={timeValue}
        onChange={(e) => {
          const [h, m, s] = e.target.value.split(':').map(Number);
          const time = new Date(fieldDate);
          time.setHours(h ?? 0);
          time.setMinutes(m ?? 0);
          time.setSeconds(s ?? 0);
          props.field.onChange(time);
        }}
      />
    </div>
  );
};

const RenderedCustomInput = <T extends FieldValues = FieldValues>(props: FieldProps<T>) => {
  return (
    <>
      {props.formField.render === undefined ? (
        <div>formField.render is undefined</div>
      ) : (
        props.formField.render(props.field)
      )}
    </>
  );
};

const RenderedRadioInput = <T extends FieldValues = FieldValues>(props: FieldProps<T>) => (
  <div className="flex flex-col gap-2">
    {props.formField.options?.map((option) => (
      <label key={option.value} className="flex items-center gap-2">
        <Input
          checked={props.field.value === option.value}
          type="radio"
          value={option.value}
          onChange={(e) => {
            props.field.onChange(e.target.value);
          }}
        />
        {option.label}
      </label>
    ))}
  </div>
);

const RenderedSelectInput = <T extends FieldValues = FieldValues>(props: FieldProps<T>) => (
  <Select value={props.field.value} onValueChange={props.field.onChange}>
    <SelectTrigger className="w-full">
      <SelectValue placeholder={props.formField.placeholder} />
    </SelectTrigger>
    <SelectContent>
      <SelectGroup>
        <SelectLabel>{props.formField.label}</SelectLabel>
        {props.formField.options?.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectGroup>
    </SelectContent>
  </Select>
);

const RenderedColorInput = <T extends FieldValues = FieldValues>(props: FieldProps<T>) => (
  <Input type="color" {...props.field} />
);

const RenderedCheckboxInput = <T extends FieldValues = FieldValues>(props: FieldProps<T>) => (
  <Checkbox
    checked={props.field.value as boolean}
    id={props.id}
    onCheckedChange={(checked) => {
      props.field.onChange(checked);
    }}
  />
);

type S3File = File & {
  uploadProgress: number;
  uploadStatus: 'idle' | 'uploading' | 'done' | 'failed';
  key?: string;
};

const isS3File = (file: S3File | string): file is S3File => {
  return typeof file === 'object' && 'uploadProgress' in file;
};

const RenderedFileUploadInput = <T extends FieldValues = FieldValues>(props: FieldProps<T>) => {
  const { getSignedUrlMutation } = useDynamicFormContext();
  const [files, setFiles] = useState<S3File[]>([]);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles) => {
      setFiles([
        ...files,
        ...acceptedFiles.map((file) =>
          Object.assign(file, {
            uploadStatus: 'idle' as const,
            uploadProgress: 0,
          }),
        ),
      ]);
    },
    accept: props.formField.accept,
    maxFiles: props.formField.maxFiles,
  });
  const removeFile = (file: S3File | string) => {
    if (isS3File(file)) {
      setFiles((prevFiles) => prevFiles.filter((prevFile) => prevFile.name !== file.name));
      const propsValue = (props.field.value as string[]).filter(
        (propsFile) => propsFile !== file.key,
      );
      props.field.onChange(propsValue);
    } else {
      const propsValue = (props.field.value as string[]).filter((propsFile) => propsFile !== file);
      props.field.onChange(propsValue);
    }
  };

  const updateFileProgress = (
    fileName: string,
    progress: number,
    status: 'idle' | 'uploading' | 'done' | 'failed',
  ) => {
    setFiles((prevFiles) =>
      prevFiles.map((file) =>
        file.name === fileName
          ? Object.assign(file, {
              uploadStatus: status,
              uploadProgress: progress,
            })
          : file,
      ),
    );
    if (status === 'done') {
      const propsValue = props.field.value as string[];
      const file = files.find((file) => file.name === fileName);
      if (file !== undefined) {
        const updatedPropsValue = [...propsValue, file.key];
        props.field.onChange(updatedPropsValue);
      }
    }
  };

  const resetFileForUpload = (fileName: string, key: string) => {
    setFiles((prevFiles) =>
      prevFiles.map((prevFile) =>
        prevFile.name === fileName
          ? Object.assign(prevFile, {
              uploadStatus: 'idle',
              uploadProgress: 0,
              key,
            })
          : prevFile,
      ),
    );
  };

  const uploadAllFiles = async () => {
    const filesToUpload = files.filter((file) => file.uploadStatus === 'idle');
    if (filesToUpload.length > 0) {
      if (getSignedUrlMutation === undefined) {
        filesToUpload.forEach((file) => {
          updateFileProgress(file.name, 0, 'failed');
        });
        return;
      }
      const signedUrls = await getSignedUrlMutation(
        filesToUpload.map((file) => {
          return { filename: file.name, contentType: file.type };
        }),
      );
      const uploadPromises = filesToUpload.map(async (file) => {
        const uploadData = signedUrls.get(file.name);
        if (uploadData?.uploadUrl === undefined) {
          updateFileProgress(file.name, 0, 'failed');
          return Promise.resolve();
        }
        resetFileForUpload(file.name, uploadData.key);
        return uploadSingleFile(file, uploadData.uploadUrl, updateFileProgress);
      });
      await Promise.all(uploadPromises);
    }
  };

  useEffect(() => {
    void uploadAllFiles();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  const previouslyUploadedFiles = useMemo(
    () =>
      (props.field.value as string[]).filter(
        (fileKey) => files.find((file) => file.key === fileKey) === undefined,
      ),
    [files, props.field.value],
  );

  return (
    <div className="flex flex-col gap-2">
      {props.formField.maxFiles === undefined ||
      props.formField.maxFiles === 0 ||
      files.length < props.formField.maxFiles ? (
        <div
          {...getRootProps()}
          className={cn(
            isDragActive ? 'border-primary bg-primary/10 ring-primary/20' : 'border-input',
            'dark:bg-input/30 flex justify-center rounded-md border bg-transparent px-6 py-20 transition-colors duration-200',
          )}
        >
          <div>
            <FileIcon aria-hidden className="text-muted-foreground/80 mx-auto h-12 w-12" />
            <div className="text-muted-foreground mt-4 flex">
              <p>Drag and drop or</p>
              <label
                className="text-primary hover:text-primary/80 relative cursor-pointer rounded-sm pl-1 font-medium hover:underline hover:underline-offset-4"
                htmlFor="file"
              >
                <span>choose file(s)</span>
                <input
                  {...getInputProps()}
                  className="sr-only"
                  id="file-upload-2"
                  name="file-upload-2"
                  type="file"
                />
              </label>
              <p className="pl-1">to upload</p>
            </div>
          </div>
        </div>
      ) : null}
      <div>
        {[...files, ...previouslyUploadedFiles].map((file) => (
          <div
            key={isS3File(file) ? (file.key ?? file.name) : file}
            className="border-border/50 relative gap-2 border-b py-2 last:border-b-0"
          >
            <div className="flex items-center space-x-2.5">
              <span className="bg-background ring-border flex h-10 w-10 shrink-0 items-center justify-center rounded-sm shadow-sm ring-1 ring-inset">
                <FileIcon aria-hidden className="text-foreground h-5 w-5" />
              </span>
              {isS3File(file) ? (
                <div className="w-full">
                  <p className="text-foreground text-xs font-medium">{file.name}</p>
                  <p className="text-muted-foreground mt-0.5 flex justify-between text-xs">
                    <span>{formatFileSize(file.size)}</span>
                    {file.uploadStatus !== 'idle' && <span>{file.uploadStatus}</span>}
                  </p>
                </div>
              ) : (
                <div className="w-full">
                  <p className="text-foreground text-xs font-medium">{file}</p>
                </div>
              )}
              {!isS3File(file) ||
                (isS3File(file) && file.uploadStatus !== 'uploading' && (
                  <Button
                    aria-label="Remove"
                    className="text-muted-foreground hover:text-foreground h-8 w-8"
                    size="icon"
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      removeFile(file);
                    }}
                  >
                    <X aria-hidden className="h-5 w-5 shrink-0" />
                  </Button>
                ))}
            </div>
            {isS3File(file) && file.uploadStatus !== 'idle' && (
              <div className="flex items-center space-x-3">
                <Progress className="h-1.5" value={file.uploadProgress} />
                <span className="text-muted-foreground text-xs">{file.uploadProgress}%</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export const RenderedFormFields: {
  [key: string]: <T extends FieldValues>(props: FieldProps<T>) => ReactNode;
} = {
  input: (props) => (
    <Input placeholder={props.formField.placeholder} {...props.field} id={props.id} />
  ),
  number: (props) => (
    <Input
      max={props.formField.max}
      min={props.formField.min}
      placeholder={props.formField.placeholder}
      step={props.formField.step}
      type="number"
      {...props.field}
      id={props.id}
    />
  ),
  textarea: (props) => (
    <Textarea placeholder={props.formField.placeholder} {...props.field} id={props.id} />
  ),
  password: (props) => (
    <Input
      placeholder={props.formField.placeholder}
      type="password"
      {...props.field}
      id={props.id}
    />
  ),
  email: (props) => (
    <Input placeholder={props.formField.placeholder} type="email" {...props.field} id={props.id} />
  ),
  tel: (props) => (
    <Input placeholder={props.formField.placeholder} type="tel" {...props.field} id={props.id} />
  ),
  url: (props) => (
    <Input placeholder={props.formField.placeholder} type="url" {...props.field} id={props.id} />
  ),
  date: RenderedDateInput,
  time: RenderedTimeInput,
  datetime: RenderedDatetimeInput,
  checkbox: RenderedCheckboxInput,
  color: RenderedColorInput,
  select: RenderedSelectInput,
  radio: RenderedRadioInput,
  custom: RenderedCustomInput,
  stringArray: RenderedStringArrayInput,
  file: RenderedFileUploadInput,
};

export const RenderFormInput = <T extends FieldValues = FieldValues>({
  type,
  field,
  formField,
  id,
}: {
  type: keyof typeof RenderedFormFields;
  field: ControllerRenderProps<T, Path<T>>;
  formField: FormField<T>;
  id: string;
}) => {
  const RenderedInput = RenderedFormFields[type];
  if (RenderedInput === undefined) {
    return null;
  }
  return <RenderedInput field={field} formField={formField} id={id} />;
};

export const RenderLabelAfter: Partial<keyof typeof RenderedFormFields> = 'checkbox';
