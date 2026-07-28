'use client';

import { Button } from '@helix/design-system/components/button';
import { cn } from '@helix/design-system/lib/utils';
import { useDocsSearch } from 'fumadocs-core/search/client';
import {
  SearchDialog as FumadocsSearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps,
} from 'fumadocs-ui/components/dialog/search';
import { useI18n } from 'fumadocs-ui/contexts/i18n';
import { useSearchContext } from 'fumadocs-ui/contexts/search';

interface SearchButtonProps {
  className?: string;
  onClick?: () => void;
}

export const SearchDialog = (props: SharedProps) => {
  const { locale } = useI18n();
  const { search, setSearch, query } = useDocsSearch({
    type: 'fetch',
    locale,
    api: '/api/search',
  });

  return (
    <FumadocsSearchDialog
      isLoading={query.isLoading}
      search={search}
      onSearchChange={setSearch}
      {...props}
    >
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList items={query.data === 'empty' ? null : query.data} />
      </SearchDialogContent>
    </FumadocsSearchDialog>
  );
};

export const SearchButton = ({ className, onClick }: SearchButtonProps) => {
  const { setOpenSearch } = useSearchContext();

  return (
    <Button
      className={cn(
        'group text-muted-foreground lg:bg-background-200 hover:lg:bg-background-200 justify-between gap-8 pr-1.5 font-normal shadow-none lg:h-8 lg:w-[150px]',
        'h-10',
        className,
      )}
      size="sm"
      type="button"
      variant="outline"
      onClick={() => {
        setOpenSearch(true);
        onClick?.();
      }}
    >
      <span>Search...</span>
      <kbd className="bg-background group-hover:text-gray-1000 pointer-events-none inline-flex h-5 items-center justify-center rounded-md border px-1.5 font-sans text-xs font-medium transition-colors select-none">
        ⌘K
      </kbd>
    </Button>
  );
};
