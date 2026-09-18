using System;
using System.Diagnostics;
using System.IO;

internal static class Launcher
{
    private static int Main(string[] args)
    {
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string script = Path.Combine(root, "scripts", "pet-launcher.ps1");
            string options = "";
            foreach (string arg in args)
            {
                if (arg == "--no-browser") options += " -NoBrowser";
                else if (arg == "--skip-firewall") options += " -SkipFirewall";
                else throw new ArgumentException("Unknown argument: " + arg);
            }
            var start = new ProcessStartInfo(
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"),
                "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\" -Action start" + options);
            start.WorkingDirectory = root;
            start.UseShellExecute = false;
            using (var process = Process.Start(start))
            {
                process.WaitForExit();
                if (process.ExitCode != 0 && !Console.IsInputRedirected)
                {
                    Console.WriteLine("Press Enter to close.");
                    Console.ReadLine();
                }
                return process.ExitCode;
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }
}
