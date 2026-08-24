'use client';

interface Props {
  filename: string;
  rows: (string | number)[][];
  label?: string;
}

/** Everything an accountant asks for arrives as a spreadsheet in the end. */
export function ExportButton({ filename, rows, label = 'Export CSV' }: Props) {
  function download() {
    const csv = rows
      .map((row) =>
        row
          .map((cell) => {
            const text = String(cell ?? '');
            return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
          })
          .join(','),
      )
      .join('\n');

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={download}
      className="rounded-md border border-line bg-surface px-2.5 py-1 text-[12px] hover:border-accent"
    >
      {label}
    </button>
  );
}
