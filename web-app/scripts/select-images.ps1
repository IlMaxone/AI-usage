$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
$taskDialog = New-Object System.Windows.Forms.OpenFileDialog
$taskDialog.Title = 'Carica immagini del progetto — coppie A1/B1, A2/B2'
$taskDialog.InitialDirectory = $env:AI_USAGE_PICKER_DIR
$taskDialog.Filter = 'Screenshot (*.png;*.jpg;*.jpeg;*.webp)|*.png;*.jpg;*.jpeg;*.webp'
$taskDialog.Multiselect = $true
$taskDialog.RestoreDirectory = $true
try {
  if ($taskDialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    ConvertTo-Json -InputObject @($taskDialog.FileNames) -Compress
  } else { '[]' }
} finally { $taskDialog.Dispose() }
