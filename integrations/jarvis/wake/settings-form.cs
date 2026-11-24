using System.Windows.Forms;
// Opening settings reveals the app window; a user click may activate it later.
public class JarvisPiSettingsForm : Form {
 protected override bool ShowWithoutActivation { get { return true; } }
}
