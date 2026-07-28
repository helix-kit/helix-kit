'use client';

import { createContext, useContext } from 'react';

type SignedUrlMutationInput = {
  filename: string;
  contentType: string;
};

type SignedUrlMutationOutput = Map<
  string,
  {
    key: string;
    uploadUrl: string;
  }
>;

export type DynamicFormSignedUrlMutation = (
  value: SignedUrlMutationInput[],
) => Promise<SignedUrlMutationOutput>;

type DynamicFormContextValue = {
  getSignedUrlMutation?: DynamicFormSignedUrlMutation;
};

const DynamicFormContext = createContext<DynamicFormContextValue>({});

export const DynamicFormContextProvider = DynamicFormContext.Provider;

export const useDynamicFormContext = () => useContext(DynamicFormContext);
