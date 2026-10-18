// LunacyStudio.exe — запускалка установленной программы. Запускает встроенный Python без окна консоли:
//   runtime\pythonw.exe -I app\studio\main.py [аргументы]
// Аргументы передаются как есть (--no-browser для автозапуска, --quit для установщика).
// Собирается компилятором C#, который входит в Windows (.NET Framework 4): packaging/build.py.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("Lunacy Studio")]
[assembly: AssemblyDescription("Неофициальная программа для клавиатуры Lunacy In Space")]
[assembly: AssemblyProduct("Lunacy Studio")]
[assembly: AssemblyCopyright("MIT License")]
[assembly: AssemblyVersion("0.0.0.0")]
[assembly: AssemblyFileVersion("0.0.0.0")]

static class Launcher
{
    [STAThread]
    static int Main(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string py = Path.Combine(root, "runtime", "pythonw.exe");
        string main = Path.Combine(root, "app", "studio", "main.py");
        if (!File.Exists(py) || !File.Exists(main))
        {
            MessageBox.Show("Не хватает файлов программы. Переустановите Lunacy Studio с github.com/ninezeroshine/lunacy-studio.",
                "Lunacy Studio", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        string rest = "";
        foreach (string a in args)
        {
            if (a.StartsWith("--") && a.IndexOf('"') < 0) rest += " " + a;   // только свои флаги, без кавычек
        }
        var psi = new ProcessStartInfo(py, "-I \"" + main + "\"" + rest) { WorkingDirectory = root, UseShellExecute = false };
        try
        {
            Process p = Process.Start(psi);
            if (Array.IndexOf(args, "--quit") >= 0) p.WaitForExit(15000);   // установщик ждёт, пока Studio закроется
        }
        catch (Exception e)
        {
            MessageBox.Show("Не удалось запустить Lunacy Studio: " + e.Message, "Lunacy Studio", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        return 0;
    }
}
